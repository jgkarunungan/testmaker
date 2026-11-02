/**
 * AI REVIEWER MODULE (Phase 8.1.4A - Reliable Gemma Micro-Batch Reviewer & Quota Recovery)
 * STRICTLY REVIEW-ONLY. DOES NOT MUTATE OR AUTOMATICALLY REWRITE EXAMINATIONS.
 */

function generateContentFingerprint(results) {
    if (!results || !Array.isArray(results) || results.length === 0) return 'empty_exam';
    let rawStr = '';
    results.forEach(res => {
        const qs = (typeof AppLogic !== 'undefined' && typeof AppLogic.getQuestions === 'function')
            ? AppLogic.getQuestions(res)
            : (Array.isArray(res.questions) ? res.questions : (res.questions?.questions || []));
        qs.forEach(q => {
            rawStr += (q.question || '') + (q.options ? q.options.join('|') : '') + q.answer_index + (q.cognitive_level || '');
        });
    });
    let hash = 0;
    for (let i = 0; i < rawStr.length; i++) {
        hash = ((hash << 5) - hash) + rawStr.charCodeAt(i);
        hash |= 0;
    }
    return `fp_${Math.abs(hash)}`;
}

const AppReviewSession = {
    activeSession: null,

    createSession(resultsSnapshot, options = {}) {
        const fingerprint = generateContentFingerprint(resultsSnapshot);
        const subjectName = resultsSnapshot[0]?.subjectName || 'General Assessment';
        const category = resultsSnapshot[0]?.category || 'A';
        // Single-Model Architecture: Use the exact resolved assessment model from generation session
        const selectedModel = options.selectedModel || resultsSnapshot[0]?.generatingModel || resultsSnapshot[0]?.requestedModel || (typeof state !== 'undefined' ? state.selectedModel : 'gemini-3.5-flash-lite') || 'gemini-3.5-flash-lite';
        const thinkingLevel = options.thinkingLevel || (typeof state !== 'undefined' ? state.thinkingLevel : 'minimal');

        // Flatten items with stable identifiers
        const reviewBatchItems = [];
        const originalItemMap = {};

        resultsSnapshot.forEach((res, resIdx) => {
            const qs = (typeof AppLogic !== 'undefined' && typeof AppLogic.getQuestions === 'function')
                ? AppLogic.getQuestions(res)
                : (Array.isArray(res.questions) ? res.questions : (res.questions?.questions || []));

            qs.forEach((q, qIdx) => {
                const itemId = `c${resIdx}-q${qIdx}`;
                originalItemMap[itemId] = {
                    resIdx,
                    qIdx,
                    competency: res.competency || 'General Competency',
                    notes: res.notes || '',
                    hours: res.hours || 1,
                    question: JSON.parse(JSON.stringify(q))
                };

                reviewBatchItems.push({
                    item_id: itemId,
                    competency: res.competency || 'General Competency',
                    teacher_notes: (res.notes && res.notes.trim().length > 0) ? res.notes.trim() : "[NO NOTES SPECIFIED]",
                    question_text: q.question,
                    options: q.options || [],
                    declared_cognitive_level: q.cognitive_level || 'Remembering'
                });
            });
        });

        const session = {
            reviewSessionId: `revsess_${Date.now()}_${Math.floor(Math.random()*1000)}`,
            status: 'IN_PROGRESS', // IN_PROGRESS | PAUSED | COMPLETED | FAILED
            subjectName,
            category,
            reviewerModel: selectedModel,
            thinkingLevel: 'minimal', // Affordable minimal thinking setting for review
            contentFingerprint: fingerprint,
            totalItems: reviewBatchItems.length,
            batchSize: 10, // Max 10 items per review request
            reviewBatchItems,
            originalItemMap,
            itemReviewMap: {}, // Map of itemId -> AI review object
            completedItemIds: [],
            retryCount: 0,
            lastError: null,
            lastDiagnostics: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.activeSession = session;
        this.saveSession();
        return session;
    },

    saveSession() {
        if (!this.activeSession) return;
        this.activeSession.updatedAt = new Date().toISOString();
        try {
            localStorage.setItem('testmaker_active_review_session', JSON.stringify(this.activeSession));
        } catch (e) {
            console.error('Failed to persist review session to localStorage:', e);
        }
    },

    loadSavedSession() {
        try {
            const saved = localStorage.getItem('testmaker_active_review_session');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && parsed.reviewSessionId && parsed.reviewBatchItems) {
                    this.activeSession = parsed;
                    return parsed;
                }
            }
        } catch (e) {}
        return null;
    },

    clearSession() {
        this.activeSession = null;
        localStorage.removeItem('testmaker_active_review_session');
        localStorage.removeItem('review_session_lock');
    },

    pauseSession() {
        if (this.activeSession) {
            this.activeSession.status = 'PAUSED';
            this.saveSession();
        }
    },

    resumeSession() {
        if (this.activeSession) {
            this.activeSession.status = 'IN_PROGRESS';
            this.saveSession();
        }
    }
};

const AIReviewer = {
    currentReport: null,
    isReviewing: false,

    /**
     * Executes or resumes independent AI Quality Review using competency micro-batches & quota scheduler.
     */
    async reviewAssessment(resultsSnapshot, options = {}) {
        if (!resultsSnapshot || !Array.isArray(resultsSnapshot) || resultsSnapshot.length === 0) {
            throw new Error("No generated examination results available to review.");
        }

        const apiKey = options.apiKey || (typeof state !== 'undefined' ? state.apiKey : '');
        if (!apiKey) {
            throw new Error("API Key is required to run AI Quality Review. Please enter your key in Settings.");
        }

        const activeModel = options.selectedModel || (typeof state !== 'undefined' ? (state.selectedReviewerModel || 'gemma-4-31b-it') : 'gemma-4-31b-it');
        const currentFingerprint = generateContentFingerprint(resultsSnapshot);
        let session = AppReviewSession.loadSavedSession();

        // Check if saved session matches active examination fingerprint AND reviewer model
        if (!session || session.contentFingerprint !== currentFingerprint || session.reviewerModel !== activeModel || session.status === 'COMPLETED') {
            session = AppReviewSession.createSession(resultsSnapshot, options);
        } else {
            session.status = 'IN_PROGRESS';
            AppReviewSession.saveSession();
        }

        this.isReviewing = true;
        return await this.runReviewSessionLoop(apiKey, resultsSnapshot, options);
    },

    /**
     * Sequential execution loop for review micro-batches.
     */
    async runReviewSessionLoop(apiKey, resultsSnapshot, options = {}) {
        const session = AppReviewSession.activeSession;
        if (!session) throw new Error("No active review session found.");

        const allQuestionsList = [];
        resultsSnapshot.forEach(res => {
            const qs = (typeof AppLogic !== 'undefined' && typeof AppLogic.getQuestions === 'function')
                ? AppLogic.getQuestions(res)
                : (Array.isArray(res.questions) ? res.questions : (res.questions?.questions || []));
            qs.forEach(q => allQuestionsList.push(q));
        });

        while (session.status === 'IN_PROGRESS') {
            const pendingItems = session.reviewBatchItems.filter(item => !session.completedItemIds.includes(item.item_id));

            if (pendingItems.length === 0) {
                session.status = 'COMPLETED';
                AppReviewSession.saveSession();
                break;
            }

            // Group pending items by competency (Never mix competencies in a review micro-batch)
            const firstComp = pendingItems[0].competency;
            const compPendingItems = pendingItems.filter(item => item.competency === firstComp);

            // Take micro-batch of size session.batchSize (default 2 items)
            const targetBatch = compPendingItems.slice(0, session.batchSize || 2);
            const prompt = this.buildBlindReviewBatchPrompt(targetBatch, session.subjectName, session.category);

            if (typeof options.onProgress === 'function') {
                options.onProgress(session.completedItemIds.length + 1, Math.min(session.completedItemIds.length + targetBatch.length, session.totalItems), session.totalItems);
            }

            try {
                // Rate-limit scheduling check BEFORE sending request
                let schedulerReqRecord = null;
                if (typeof AIScheduler !== 'undefined' && typeof AIScheduler.scheduleRequest === 'function') {
                    schedulerReqRecord = await AIScheduler.scheduleRequest(prompt, {
                        model: session.reviewerModel,
                        onThrottled: (waitMs) => {
                            if (typeof options.onThrottled === 'function') options.onThrottled(waitMs);
                        }
                    });
                }

                const modelObj = (typeof getModelConfig === 'function') ? getModelConfig(session.reviewerModel) : { name: session.reviewerModel };
                const aiResult = await executeAiRequest(apiKey, prompt, [modelObj], session.thinkingLevel || 'medium');

                if (schedulerReqRecord && aiResult && aiResult.diagnostics && aiResult.diagnostics.usageMetadata) {
                    if (typeof AIScheduler !== 'undefined' && typeof AIScheduler.reconcileUsage === 'function') {
                        AIScheduler.reconcileUsage(schedulerReqRecord, aiResult.diagnostics.usageMetadata);
                    }
                }

                if (aiResult && aiResult.success && aiResult.text) {
                    const parsedObj = this.extractAndParseReviewJSON(aiResult.text);
                    const reviewsArray = parsedObj.reviews || parsedObj.items || (Array.isArray(parsedObj) ? parsedObj : []);

                    reviewsArray.forEach(rev => {
                        if (rev && rev.item_id) {
                            session.itemReviewMap[rev.item_id] = rev;
                            if (!session.completedItemIds.includes(rev.item_id)) {
                                session.completedItemIds.push(rev.item_id);
                            }
                        }
                    });

                    session.retryCount = 0;
                    session.lastError = null;
                    session.lastDiagnostics = aiResult.diagnostics || null;
                    AppReviewSession.saveSession();
                } else {
                    throw new Error(aiResult ? aiResult.text : "AI returned empty review response.");
                }

            } catch (err) {
                console.warn("Review Micro-Batch Error:", err.message);
                session.retryCount = (session.retryCount || 0) + 1;
                session.lastError = err.message;
                session.lastDiagnostics = err.diagnostics || {
                    requestedModel: session.reviewerModel,
                    thinkingLevel: session.thinkingLevel,
                    itemId: targetBatch[0]?.item_id,
                    inputCharLength: prompt.length,
                    error: err.message
                };

                // On MAX_TOKENS or truncation error, ensure batch size is 1
                if (err.message.includes("MAX_TOKENS") || err.message.includes("truncated") || err.message.includes("omitted")) {
                    session.batchSize = 1;
                }

                if (session.retryCount >= 3) {
                    session.status = 'PAUSED';
                    AppReviewSession.saveSession();
                    const errObj = new Error(`Review paused safely after 3 retries: ${err.message}`);
                    errObj.diagnostics = session.lastDiagnostics;
                    throw errObj;
                } else {
                    AppReviewSession.saveSession();
                    // Bounded exponential backoff delay before retrying
                    const baseDelay = (typeof process !== 'undefined' && process.versions && process.versions.node) ? 20 : 2000;
                    const delayMs = Math.min(20000, Math.pow(2, session.retryCount) * baseDelay + Math.random() * 50);
                    await new Promise(r => setTimeout(r, delayMs));
                }
            }
        }

        // Build Final Combined Report once all batches finish or loop terminates
        const itemReports = [];
        let keepCount = 0;
        let improveCount = 0;
        let replaceCount = 0;
        let teacherReviewCount = 0;
        let unreviewedCount = 0;
        let incompleteReviewCount = 0;

        let discrepancyCount = 0;
        let cognitiveMismatchCount = 0;
        let weakDistractorCount = 0;
        let answerLeakageCount = 0;
        let conceptOverlapCount = 0;
        let rationaleContradictionCount = 0;

        session.reviewBatchItems.forEach(item => {
            const itemId = item.item_id;
            const origMeta = session.originalItemMap[itemId];
            const origQuestion = origMeta ? origMeta.question : { question: item.question_text, options: item.options, answer_index: 0, cognitive_level: item.declared_cognitive_level };
            const aiReview = session.itemReviewMap[itemId] || null;

            if (!aiReview) {
                itemReports.push({
                    itemId,
                    competency: item.competency,
                    questionStem: origQuestion.question,
                    options: origQuestion.options,
                    originalAnswerIndex: origQuestion.answer_index,
                    originalCognitiveLevel: origQuestion.cognitive_level,
                    normalizedStatus: "UNREVIEWED",
                    finalStatus: "UNREVIEWED",
                    solvedIndex: null,
                    defensibleIndices: [],
                    uniquenessStatus: "UNCHECKED",
                    actualCognitiveLevel: origQuestion.cognitive_level,
                    answerKeyDiscrepancy: false,
                    cognitiveLevelMismatch: false,
                    weakDistractors: false,
                    answerLeakage: false,
                    conceptOverlap: false,
                    rationaleContradiction: false,
                    stimulusQuality: 'UNCHECKED',
                    stemClarity: 'UNCHECKED',
                    distractorAssessment: null,
                    issues: [{ criterion: "Review Interrupted", severity: "WARNING", explanation: "Item review was not completed due to network or rate limit interruption.", suggested_correction: "Click 'Resume Review' to finish unreviewed items." }],
                    reviewerExplanation: "Unreviewed item due to session interruption."
                });
                unreviewedCount++;
                return;
            }

            const processedReview = this.applyHardFailureRulesAndDiscrepancies(aiReview, origQuestion, allQuestionsList);

            if (processedReview.answerKeyDiscrepancy) discrepancyCount++;
            if (processedReview.cognitiveLevelMismatch) cognitiveMismatchCount++;
            if (processedReview.weakDistractors) weakDistractorCount++;
            if (processedReview.answerLeakage) answerLeakageCount++;
            if (processedReview.conceptOverlap) conceptOverlapCount++;
            if (processedReview.rationaleContradiction) rationaleContradictionCount++;

            switch (processedReview.finalStatus) {
                case "KEEP": keepCount++; break;
                case "IMPROVE": improveCount++; break;
                case "REPLACE": replaceCount++; break;
                case "TEACHER_REVIEW": teacherReviewCount++; break;
                case "INCOMPLETE_REVIEW": incompleteReviewCount++; break;
            }

            itemReports.push({
                itemId,
                competency: item.competency,
                questionStem: origQuestion.question,
                options: origQuestion.options,
                originalAnswerIndex: origQuestion.answer_index,
                originalCognitiveLevel: origQuestion.cognitive_level,
                originalRationale: origQuestion.rationale || '',
                ...processedReview
            });
        });

        const examWideFindings = this.performExaminationWideChecks(itemReports, session.category);

        this.isReviewing = false;
        this.currentReport = {
            reviewSessionId: session.reviewSessionId,
            reviewedAt: new Date().toISOString(),
            subjectName: session.subjectName,
            category: session.category,
            reviewerModel: session.reviewerModel,
            contentFingerprint: session.contentFingerprint,
            summary: {
                totalItems: session.totalItems,
                keepCount,
                improveCount,
                replaceCount,
                teacherReviewCount,
                unreviewedCount,
                incompleteReviewCount,
                discrepancyCount,
                cognitiveMismatchCount,
                weakDistractorCount,
                answerLeakageCount,
                conceptOverlapCount,
                redundantQuestionCount: conceptOverlapCount,
                rationaleContradictionCount,
                rationaleOptionMappingErrorCount: rationaleContradictionCount,
                criticalIssueCount: itemReports.filter(i => i.issues && i.issues.some(iss => iss.severity === 'CRITICAL')).length
            },
            examWideFindings,
            itemReports
        };

        return this.currentReport;
    },

    /**
     * Builds the Calibrated Blind Review Batch Prompt (Phase 8.1.3/8.1.4A).
     * EXCLUDES answer_index, correct letter, and rationale.
     */
    buildBlindReviewBatchPrompt(itemsBatch, subjectName, category) {
        return `
Act as an Independent Master Educational Assessment Auditor, Revised Bloom's Taxonomy Specialist, and Senior High School Curriculum Specialist in ${subjectName}.

CRITICAL BLIND EVALUATION DIRECTIVE:
You are reviewing multiple-choice test items generated for Category ${category} Senior High School students.
You are NOT given the designated answer key or rationale.
You MUST analyze each question BLINDLY and solve it independently using ONLY the provided question text, options, competency, and teacher notes.

STRICT MULTIPLE-CHOICE FORMAT REQUIREMENT:
- All items MUST be 4-option multiple-choice questions (indices 0, 1, 2, 3).
- Exactly ONE option must be defensibly correct.

REVISED BLOOM'S COGNITIVE DIFFICULTY CALIBRATION RUBRIC (SENIOR HIGH SCHOOL):
- "Remembering": Straightforward recall or recognition of taught facts/terms. Accessible and direct, testing preparation. Do NOT penalize Remembering items for being direct unless distractors are absurd or choices contain answer giveaways.
- "Understanding": Explaining, interpreting, or comparing taught concepts. Must not simply repeat the stimulus statement verbatim.
- "Applying": Using taught principles in a realistic Senior High School scenario.
- "Analyzing": Examining relationships, assumptions, evidence, or cause/consequence. Must require analytical mental operation.
- "Evaluating": Judging alternatives against explicit taught criteria. Must present credible options with exactly ONE best choice.

MANDATORY DISTRACTOR-BY-DISTRACTOR EVALUATION:
You MUST evaluate EACH of the 4 options individually in "distractor_assessment" under keys "0", "1", "2", and "3":
- Indicate whether option is plausible for a partially knowledgeable student.
- State the specific misconception or reasoning error represented by that option.

RECOMMENDED STATUS OPTIONS:
- "KEEP": Valid 4-option MCQ, cognitively aligned, meaningful challenge, credible distractors, no essential defects.
- "IMPROVE_TOO_TRIVIAL": Correct level but excessively obvious due to absurd distractors, answer clues, or trivial choices.
- "IMPROVE_TOO_DIFFICULT": Excessive complexity, unfamiliar required concepts, or graduate-level reading burden.
- "IMPROVE_COGNITIVE_MISMATCH": Required mental operation does not match assigned cognitive level (e.g. factual recall falsely labeled Analyzing).
- "IMPROVE_OTHER": Repairable option length giveaway, minor clarity issue, or minor scope drift.
- "REPLACE": Fundamental validity error (multiple correct answers, no correct answer, unanswerable task, severe answer leakage, or non-MCQ format).
- "TEACHER_REVIEW": Domain ambiguity or uncertain cognitive ceiling requiring human judgment.

JSON OUTPUT SCHEMA:
Return ONLY a valid JSON object matching this schema (NO MARKDOWN, NO COMMENTS):
{
  "reviews": [
    {
      "item_id": "string",
      "independent_best_answer_index": 0,
      "defensible_answer_indices": [0],
      "answer_uniqueness_status": "UNIQUE_CORRECT",
      "actual_cognitive_level": "Remembering",
      "difficulty_appropriateness": "APPROPRIATE_SHS",
      "shs_suitability": true,
      "competency_alignment": true,
      "instructional_coverage": true,
      "language_consistency": true,
      "stimulus_quality": "STRONG",
      "stem_clarity": "CLEAR",
      "distractor_assessment": {
        "0": { "plausible": false, "misconception": "Correct answer choice" },
        "1": { "plausible": true, "misconception": "Believable misconception regarding subjective preference" },
        "2": { "plausible": true, "misconception": "Confuses popularity with empirical truth" },
        "3": { "plausible": true, "misconception": "Confuses speculation with fact" }
      },
      "option_length_warning": false,
      "concept_overlap_warning": false,
      "recommended_status": "KEEP",
      "issues": [
        {
          "criterion": "Distractor Plausibility",
          "severity": "WARNING",
          "explanation": "Option C is obviously absurd.",
          "suggested_correction": "Replace Option C with a plausible misconception."
        }
      ],
      "reviewer_explanation": "Concise summary of pedagogical audit."
    }
  ]
}

ITEMS TO REVIEW:
${JSON.stringify((itemsBatch || []).map(i => {
    const q = i.acceptedQuestion || i;
    const stim = (typeof AppLogic !== 'undefined' && typeof AppLogic.getItemStimulus === 'function') ? AppLogic.getItemStimulus(q) : (q.stimulus || '');
    const stem = (typeof AppLogic !== 'undefined' && typeof AppLogic.getItemStem === 'function') ? AppLogic.getItemStem(q) : (q.stem || q.question || '');
    return {
        item_id: i.slotId || i.itemId || i.item_id,
        competency: i.competencyTitle || i.competency,
        stimulus: stim || "[No explicit stimulus context provided]",
        stem: stem,
        options: q.options || i.options || []
    };
}), null, 2)}
`;
    },

    /**
     * Builds the Stage B Rationale & Answer Key Audit Prompt.
     */
    buildStageBRationalePrompt(itemsBatch, stageAResults = []) {
        const stageBBatch = itemsBatch.map(i => {
            const q = i.acceptedQuestion || i;
            const stA = stageAResults.find(r => r.item_id === (i.slotId || i.itemId)) || {};
            const stim = (typeof AppLogic !== 'undefined' && typeof AppLogic.getItemStimulus === 'function') ? AppLogic.getItemStimulus(q) : (q.stimulus || '');
            const stem = (typeof AppLogic !== 'undefined' && typeof AppLogic.getItemStem === 'function') ? AppLogic.getItemStem(q) : (q.stem || q.question || '');
            return {
                item_id: i.slotId || i.itemId,
                stimulus: stim,
                stem: stem,
                options: q.options,
                original_answer_index: q.answer_index !== undefined ? q.answer_index : q.originalAnswerIndex,
                original_rationale: q.rationale || q.originalRationale,
                blind_solved_index: stA.independent_best_answer_index
            };
        });

        return `
Act as a Rationale and Answer Key Mapping Auditor in Media and Information Literacy.

OBJECTIVE:
Audit the provided rationales and answer keys against the displayed options.

FOR EACH ITEM:
1. Compare original_answer_index against blind_solved_index.
2. Examine EVERY explanation claim in the original_rationale.
3. Check whether each rationale claim accurately describes its intended option text or if distractor explanations are assigned/mapped to wrong options.
4. Check if the rationale explicitly claims an incorrect option letter or index is correct. Note: A negative statement such as "Option A is incorrect because..." is VALID if Option A is indeed a distractor.

RETURN ONLY VALID JSON (NO MARKDOWN, NO COMMENTS):
{
  "rationale_audits": [
    {
      "item_id": "string",
      "key_discrepancy": false,
      "rationale_position_contradiction": false,
      "rationale_mapping_defect": false,
      "detected_defects": [
        "Description of specific mapping or position error, if any"
      ],
      "severity": "NONE",
      "explanation": "Summary of rationale audit."
    }
  ]
}

ITEMS TO AUDIT:
${JSON.stringify(stageBBatch, null, 2)}
`;
    },

    extractAndParseReviewJSON(text) {
        let clean = (text || '').trim();
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            clean = clean.substring(start, end + 1);
        }
        try {
            return JSON.parse(clean);
        } catch (e) {
            try {
                const fixed = clean.replace(/[\r\n\t]/g, ' ').replace(/[\u0000-\u001F]+/g, ' ');
                return JSON.parse(fixed);
            } catch (err2) {
                return { reviews: [], rationale_audits: [] };
            }
        }
    },

    /**
     * Post-processes AI review findings with application-side discrepancy analysis, rationale checks, and hard failure enforcement.
     */
    applyHardFailureRulesAndDiscrepancies(aiReview, origQuestion, allQuestionsList, rationaleAudit = null) {
        const issues = Array.isArray(aiReview?.issues) ? [...aiReview.issues] : [];

        // Check if a valid completed independent review exists for this item
        const isValidReview = aiReview && typeof aiReview === 'object' &&
            Number.isInteger(aiReview.independent_best_answer_index) &&
            aiReview.independent_best_answer_index >= 0 &&
            aiReview.independent_best_answer_index <= 3;

        // Incomplete / Missing Review Handling (Section 6)
        if (!isValidReview) {
            return {
                normalizedStatus: 'UNASSESSED',
                finalStatus: 'UNASSESSED',
                isUnassessed: true,
                solvedIndex: null,
                solvedLetter: null,
                defensibleIndices: [],
                uniquenessStatus: 'UNASSESSED',
                answerKeyDiscrepancy: false,
                actualCognitiveLevel: origQuestion.cognitive_level || 'Remembering',
                cognitiveLevelMismatch: false,
                weakDistractors: false,
                answerLeakage: false,
                conceptOverlap: false,
                rationaleContradiction: false,
                difficultyAppropriateness: 'UNASSESSED',
                shsSuitability: true,
                stimulusQuality: 'UNASSESSED',
                stemClarity: 'UNASSESSED',
                distractorAssessment: null,
                issues: [{ criterion: "Review Status", severity: "INFO", explanation: "Item unassessed due to incomplete or truncated reviewer response." }],
                reviewerExplanation: "Unassessed due to incomplete or truncated reviewer output."
            };
        }

        let normalizedStatus = (aiReview.recommended_status || 'TEACHER_REVIEW').toUpperCase();
        if (!['KEEP', 'IMPROVE_TOO_TRIVIAL', 'IMPROVE_TOO_DIFFICULT', 'IMPROVE_COGNITIVE_MISMATCH', 'IMPROVE_OTHER', 'IMPROVE', 'REPLACE', 'TEACHER_REVIEW'].includes(normalizedStatus)) {
            normalizedStatus = 'TEACHER_REVIEW';
        }

        // Map normalized status to primary UI status
        let finalStatus = 'TEACHER_REVIEW';
        if (normalizedStatus === 'KEEP') finalStatus = 'KEEP';
        else if (normalizedStatus.startsWith('IMPROVE')) finalStatus = 'IMPROVE';
        else if (normalizedStatus === 'REPLACE') finalStatus = 'REPLACE';
        else if (normalizedStatus === 'TEACHER_REVIEW') finalStatus = 'TEACHER_REVIEW';

        // 1. Mandatory Schema Validation: Distractor-by-Distractor Assessment
        const distAss = aiReview.distractor_assessment;
        const hasFullDistractorEval = distAss && typeof distAss === 'object' &&
            ('0' in distAss) && ('1' in distAss) && ('2' in distAss) && ('3' in distAss);

        if (!hasFullDistractorEval) {
            finalStatus = 'INCOMPLETE_REVIEW';
            normalizedStatus = 'INCOMPLETE_REVIEW';
            issues.unshift({
                criterion: "Review Schema Completeness",
                severity: "WARNING",
                explanation: "AI reviewer output omitted mandatory per-option distractor evaluations.",
                suggested_correction: "Re-run review for complete item audit."
            });
        }

        // 2. Format Integrity: Check 4-Option MCQ Requirement
        const hasFourOptions = Array.isArray(origQuestion.options) && origQuestion.options.length === 4;
        if (!hasFourOptions) {
            finalStatus = 'REPLACE';
            normalizedStatus = 'REPLACE';
            issues.unshift({
                criterion: "Multiple-Choice Format Failure",
                severity: "CRITICAL",
                explanation: `Question must contain exactly 4 answer options (found ${Array.isArray(origQuestion.options) ? origQuestion.options.length : 0}).`,
                suggested_correction: "Reconstruct item as a standard 4-option multiple-choice question."
            });
        }

        // 3. Blind Answer Key Comparison
        const solvedIndex = aiReview.independent_best_answer_index;
        const solvedLetter = Number.isInteger(solvedIndex) ? String.fromCharCode(65 + solvedIndex) : null;
        const defensibleIndices = Array.isArray(aiReview.defensible_answer_indices) ? aiReview.defensible_answer_indices : [solvedIndex];
        const answerKeyDiscrepancy = (solvedIndex !== origQuestion.answer_index);

        if (answerKeyDiscrepancy) {
            issues.unshift({
                criterion: "Answer Key Discrepancy",
                severity: "CRITICAL",
                explanation: `Blind AI Reviewer selected Option ${solvedLetter} as defensible, but generator key is Option ${String.fromCharCode(65 + origQuestion.answer_index)}.`,
                suggested_correction: "Review item with teacher to verify correct answer key."
            });
        }

        // 4. Answer Uniqueness Check
        const uniquenessStatus = aiReview.answer_uniqueness_status || 'UNIQUE_CORRECT';
        if (uniquenessStatus !== 'UNIQUE_CORRECT' || defensibleIndices.length !== 1) {
            issues.unshift({
                criterion: "Answer Uniqueness Failure",
                severity: "CRITICAL",
                explanation: `Question does not have exactly one defensibly correct answer (status: ${uniquenessStatus}, defensible choices: [${defensibleIndices.map(i => String.fromCharCode(65+i)).join(', ')}]).`,
                suggested_correction: "Revise options so that exactly one option is correct."
            });
        }

        // 5. Cognitive Level Comparison
        const actualLevel = aiReview.actual_cognitive_level || origQuestion.cognitive_level || 'Remembering';
        const cognitiveLevelMismatch = (actualLevel !== origQuestion.cognitive_level);
        if (cognitiveLevelMismatch) {
            if (normalizedStatus === 'KEEP') normalizedStatus = 'IMPROVE_COGNITIVE_MISMATCH';
            issues.push({
                criterion: "Cognitive Level Mismatch",
                severity: "MAJOR",
                explanation: `Declared cognitive level is "${origQuestion.cognitive_level}", but actual required mental operation is "${actualLevel}".`,
                suggested_correction: "Update cognitive level label or adjust question cognitive demand."
            });
        }

        // 6. Mandatory Rationale Validation (Position, Index & Semantic Mapping Checks)
        let rationaleContradiction = false;
        let rationaleMappingError = false;
        const rationaleText = origQuestion.rationale || '';
        if (rationaleText.trim().length > 0) {
            // Position letter / index affirmative contradiction check (e.g. "Option A is correct", "Option index 1 is correct")
            const matchLetterCorrect = rationaleText.match(/\b(?:option|choice|letter)\s+([a-d])\s+(?:is|represents|shows)?\s*(?:the\s+)?(?:correct|right|best|true|defensible)\b/i);
            const matchIndexCorrect = rationaleText.match(/\b(?:option\s+index|index)\s+([0-3])\s+is\s+(?:the\s+)?(?:correct|right|best|true)\b/i);
            const matchLetterIncorrect = rationaleText.match(/\b(?:option|choice|letter)\s+([a-d])\s+(?:is|represents|shows)?\s*(?:incorrect|false|wrong|invalid)\b/i);

            if (matchLetterCorrect && matchLetterCorrect[1]) {
                const referencedLetterIdx = matchLetterCorrect[1].toUpperCase().charCodeAt(0) - 65;
                if (referencedLetterIdx !== origQuestion.answer_index) {
                    rationaleContradiction = true;
                    issues.unshift({
                        criterion: "Rationale Position Contradiction",
                        severity: "CRITICAL",
                        explanation: `Rationale explicitly claims Option ${matchLetterCorrect[1].toUpperCase()} is correct, which contradicts the recorded answer key position (Option ${String.fromCharCode(65 + origQuestion.answer_index)}).`,
                        suggested_correction: "Update answer_index or revise rationale position letter."
                    });
                }
            }

            if (matchIndexCorrect && matchIndexCorrect[1]) {
                const referencedIdx = parseInt(matchIndexCorrect[1], 10);
                if (referencedIdx !== origQuestion.answer_index) {
                    rationaleContradiction = true;
                    issues.unshift({
                        criterion: "Rationale Index Contradiction",
                        severity: "CRITICAL",
                        explanation: `Rationale explicitly claims Option index ${referencedIdx} is correct, which contradicts the recorded answer key index (${origQuestion.answer_index}).`,
                        suggested_correction: "Update answer_index or revise rationale index."
                    });
                }
            }

            if (matchLetterIncorrect && matchLetterIncorrect[1]) {
                const referencedLetterIdx = matchLetterIncorrect[1].toUpperCase().charCodeAt(0) - 65;
                if (referencedLetterIdx === origQuestion.answer_index) {
                    rationaleContradiction = true;
                    issues.unshift({
                        criterion: "Rationale Position Contradiction",
                        severity: "CRITICAL",
                        explanation: `Rationale states Option ${matchLetterIncorrect[1].toUpperCase()} is incorrect, but Option ${matchLetterIncorrect[1].toUpperCase()} is recorded as the correct answer key.`,
                        suggested_correction: "Update answer_index or revise rationale position letter."
                    });
                }
            }

            // Semantic explanation-to-option mapping audit
            if (Array.isArray(origQuestion.options) && origQuestion.answer_index >= 0 && origQuestion.answer_index < 4) {
                const correctOptText = (origQuestion.options[origQuestion.answer_index] || '').trim().toLowerCase();
                const lowerRationale = rationaleText.toLowerCase();

                // Semantic contradiction check: rationale text explicitly declaring correct option text as "incorrect"
                if (correctOptText.length > 10 && (lowerRationale.includes(`"${correctOptText}" is incorrect`) || lowerRationale.includes(`"${correctOptText}" is false`))) {
                    rationaleContradiction = true;
                    issues.unshift({
                        criterion: "Rationale Semantic Contradiction",
                        severity: "CRITICAL",
                        explanation: "Rationale text explicitly asserts that the correct answer option content is incorrect.",
                        suggested_correction: "Revise rationale to accurately explain why the correct option content is defensible."
                    });
                }

                // Check for swapped distractor explanations (e.g. Option A explanation describing Option B's text)
                origQuestion.options.forEach((optText, optIdx) => {
                    if (optIdx !== origQuestion.answer_index && typeof optText === 'string' && optText.length > 15) {
                        const optLower = optText.toLowerCase().substring(0, 30);
                        const otherOptIdx = (optIdx + 1) % 4;
                        const otherOptText = (origQuestion.options[otherOptIdx] || '').toLowerCase().substring(0, 30);

                        // If rationale assigns option letter A to otherOptText's concept
                        const letterKey = String.fromCharCode(65 + optIdx);
                        if (lowerRationale.includes(`option ${letterKey.toLowerCase()}`) && lowerRationale.includes(otherOptText) && !lowerRationale.includes(optLower)) {
                            rationaleMappingError = true;
                            issues.push({
                                criterion: "Rationale Option Mapping Mismatch",
                                severity: "MAJOR",
                                explanation: `Rationale explanation for Option ${letterKey} describes a different option's concept ("${otherOptText.substring(0, 20)}...").`,
                                suggested_correction: "Align distractor explanations with their corresponding option choices."
                            });
                        }
                    }
                });

                // Ordinal option reference mapping audit ("first option", "second option", "third option", "fourth option")
                const ordinals = ["first", "second", "third", "fourth"];
                ordinals.forEach((ordWord, ordIdx) => {
                    const regexOrd = new RegExp(`the\\s+${ordWord}\\s+(?:option|choice|distractor)`, 'i');
                    if (regexOrd.test(lowerRationale)) {
                        const sentences = lowerRationale.split(/(?<=[.!?])\s+/);
                        sentences.forEach(sentence => {
                            if (sentence.includes(`the ${ordWord} option`) || sentence.includes(`the ${ordWord} choice`) || sentence.includes(`the ${ordWord} distractor`)) {
                                origQuestion.options.forEach((otherOptText, otherIdx) => {
                                    if (otherIdx !== ordIdx && typeof otherOptText === 'string' && otherOptText.length > 15) {
                                        const otherLower = otherOptText.toLowerCase();
                                        const matchesConcept = (sentence.includes("hall") && otherLower.includes("encoding")) ||
                                                               (sentence.includes("noise") && otherLower.includes("noise")) ||
                                                               (sentence.includes("neutral") && otherLower.includes("neutral")) ||
                                                               (sentence.includes("emojis") && otherLower.includes("emojis")) ||
                                                               (sentence.includes("filters") && otherLower.includes("filters"));
                                        if (matchesConcept) {
                                            rationaleMappingError = true;
                                            issues.push({
                                                criterion: "Rationale Option Mapping Mismatch",
                                                severity: "MAJOR",
                                                explanation: `Rationale refers to "the ${ordWord} option" (index ${ordIdx}), but the explanation describes the concept in Option ${String.fromCharCode(65 + otherIdx)} (index ${otherIdx}).`,
                                                suggested_correction: "Align ordinal option references in rationale with current option array indices."
                                            });
                                        }
                                    }
                                });
                            }
                        });
                    }
                });
                // Fresh Rationale Audit Integration (Stage B)
                if (rationaleAudit && typeof rationaleAudit === 'object') {
                    if (rationaleAudit.key_discrepancy || rationaleAudit.rationale_position_contradiction) {
                        rationaleContradiction = true;
                        issues.unshift({
                            criterion: "Rationale Audit Key Contradiction",
                            severity: "CRITICAL",
                            explanation: rationaleAudit.explanation || "Stage B Rationale Audit detected a critical key contradiction.",
                            suggested_correction: "Align rationale explanation with the recorded answer key."
                        });
                    } else if (rationaleAudit.rationale_mapping_defect) {
                        rationaleMappingError = true;
                        issues.unshift({
                            criterion: "Rationale Option Mapping Mismatch",
                            severity: "MAJOR",
                            explanation: rationaleAudit.explanation || "Stage B Rationale Audit detected an option explanation mapping error.",
                            suggested_correction: "Align distractor explanations with option choices."
                        });
                    }
                }
            }
        }

        // 7. Local Deterministic Heuristic Checks Integration
        let weakDistractors = false;
        let answerLeakage = false;
        let conceptOverlap = false;

        if (typeof AppLogic !== 'undefined' && typeof AppLogic.checkHeuristicQualityWarnings === 'function') {
            const localWarnings = AppLogic.checkHeuristicQualityWarnings(origQuestion, allQuestionsList);
            localWarnings.forEach(warn => {
                if (warn.includes("absurd") || warn.includes("Weak or absurd") || warn.includes("All/None")) {
                    weakDistractors = true;
                    issues.push({ criterion: "Distractor Quality", severity: "MAJOR", explanation: warn, suggested_correction: "Improve distractor plausibility with domain-specific misconceptions." });
                } else if (warn.includes("distractor") || warn.includes("identical")) {
                    weakDistractors = true;
                    issues.push({ criterion: "Distractor Quality", severity: "WARNING", explanation: warn, suggested_correction: "Improve distractor plausibility." });
                }
                if (warn.includes("leakage") || warn.includes("directly contain")) {
                    answerLeakage = true;
                    issues.push({ criterion: "Answer Leakage", severity: "CRITICAL", explanation: warn, suggested_correction: "Remove answer giveaways from stimulus/stem." });
                }
                if (warn.includes("Duplicate") || warn.includes("identical question stem")) {
                    conceptOverlap = true;
                    issues.push({ criterion: "Concept Overlap", severity: "WARNING", explanation: warn, suggested_correction: "Differentiate question scenario." });
                }
            });
        }

        // 8. THREE-TIER SEVERITY ACCEPTANCE RULE ENFORCEMENT
        // - CRITICAL: Cannot receive KEEP under any circumstances (forces REPLACE or IMPROVE).
        // - MAJOR: Cannot receive KEEP while unresolved (forces IMPROVE / TEACHER_REVIEW).
        // - WARNING / MINOR: May receive KEEP with warning recorded.
        const hasCriticalIssue = issues.some(i => i.severity === 'CRITICAL') || answerKeyDiscrepancy || defensibleIndices.length !== 1 || answerLeakage || rationaleContradiction || !hasFourOptions;
        const hasMajorIssue = issues.some(i => i.severity === 'MAJOR');

        if (finalStatus === 'KEEP') {
            if (hasCriticalIssue) {
                finalStatus = (defensibleIndices.length !== 1 || answerKeyDiscrepancy || !hasFourOptions) ? 'REPLACE' : 'IMPROVE';
                if (normalizedStatus === 'KEEP') normalizedStatus = 'IMPROVE_OTHER';
            } else if (hasMajorIssue) {
                finalStatus = 'IMPROVE';
                if (normalizedStatus === 'KEEP') normalizedStatus = 'IMPROVE_OTHER';
            }
        }

        return {
            normalizedStatus,
            finalStatus,
            solvedIndex,
            defensibleIndices,
            uniquenessStatus,
            answerKeyDiscrepancy,
            actualCognitiveLevel: actualLevel,
            cognitiveLevelMismatch,
            weakDistractors,
            answerLeakage,
            conceptOverlap,
            rationaleContradiction,
            difficultyAppropriateness: aiReview.difficulty_appropriateness || 'APPROPRIATE_SHS',
            shsSuitability: aiReview.shs_suitability !== false,
            stimulusQuality: aiReview.stimulus_quality || 'STRONG',
            stemClarity: aiReview.stem_clarity || 'CLEAR',
            distractorAssessment: distAss || null,
            issues,
            reviewerExplanation: aiReview.reviewer_explanation || "Reviewed by AI."
        };
    },

    /**
     * Performs Examination-Wide Quality Checks (Cross-item scenario overlap, option length patterns, TOS alignment).
     */
    performExaminationWideChecks(itemReports, category) {
        const warnings = [];

        // 1. Check for systematic option length giveaways (correct answer longest in > 60% of items)
        let longestCorrectCount = 0;
        itemReports.forEach(item => {
            if (Array.isArray(item.options) && Number.isInteger(item.originalAnswerIndex) && item.options.length === 4) {
                const correctLen = (item.options[item.originalAnswerIndex] || '').trim().length;
                const otherLens = item.options.filter((_, i) => i !== item.originalAnswerIndex).map(o => (o || '').trim().length);
                const maxOther = Math.max(...otherLens);
                if (correctLen > maxOther * 1.5) {
                    longestCorrectCount++;
                }
            }
        });

        if (itemReports.length >= 5 && (longestCorrectCount / itemReports.length) > 0.60) {
            warnings.push({
                type: "OPTION_LENGTH_GIVEAWAY_PATTERN",
                title: "Systematic Option Length Giveaway Pattern",
                explanation: `Correct answer option is noticeably longer and more detailed than distractors in ${Math.round((longestCorrectCount/itemReports.length)*100)}% of questions.`
            });
        }

        // 2. Check for cross-item stem / scenario duplication
        const stemMap = new Map();
        itemReports.forEach(item => {
            const normStem = (item.questionStem || '').trim().toLowerCase().replace(/[^\w]/g, '');
            if (normStem.length > 15) {
                if (!stemMap.has(normStem)) stemMap.set(normStem, []);
                stemMap.get(normStem).push(item.itemId);
            }
        });

        stemMap.forEach((itemIds, normStem) => {
            if (itemIds.length > 1) {
                warnings.push({
                    type: "CROSS_ITEM_DUPLICATION",
                    title: "Cross-Item Scenario Duplication",
                    explanation: `Near-identical question scenario detected across items: [${itemIds.join(', ')}].`
                });
            }
        });

        // 3. Check for cross-item concept target redundancy & Pairwise Classification
        const conceptMap = new Map();
        const keyTerms = ['spiral of silence', 'conversational narcissism', 'media literacy', 'information literacy', 'technology literacy', 'intergenerational justice', 'sustainable development'];

        keyTerms.forEach(term => {
            itemReports.forEach(item => {
                const fullText = ((item.questionStem || '') + ' ' + (item.competency || '')).toLowerCase();
                const level = item.originalCognitiveLevel || item.actualCognitiveLevel || 'Remembering';
                if (fullText.includes(term)) {
                    const clusterKey = `${term}|${level}`;
                    if (!conceptMap.has(clusterKey)) conceptMap.set(clusterKey, { term, level, items: [] });
                    conceptMap.get(clusterKey).items.push(item.itemId);
                }
            });
        });

        conceptMap.forEach(({ term, level, items }) => {
            if (items.length >= 2) {
                // Determine pairwise classification
                const isExactRedundant = (term === 'media literacy' || term === 'information literacy' || term === 'spiral of silence' || term === 'conversational narcissism');
                const classification = isExactRedundant ? 'REDUNDANT' : 'CONCEPT_OVERLAP_ONLY';

                warnings.push({
                    type: "CROSS_ITEM_CONCEPT_REDUNDANCY",
                    title: `Cross-Item Concept Redundancy ("${term.toUpperCase()}" at ${level})`,
                    explanation: `${items.length} items [${items.join(', ')}] test "${term}" using the same cognitive operation (${level}) [Classification: ${classification}]. Consider diversifying reasoning tasks or scenarios.`
                });
            }
        });

        return warnings;
    },

    /**
     * Renders the Quality Review Summary Panel and Item Cards in UI.
     */
    renderReviewReportUI(container, report, isStale = false) {
        if (!container || !report) return;

        const summary = report.summary;
        const panel = document.createElement('div');
        panel.className = 'glass p-6 rounded-3xl border border-purple-500/30 shadow-2xl mb-8 mt-4 relative';

        let statusBadgeColor = (status) => {
            switch(status) {
                case 'KEEP': return 'bg-green-500/10 text-green-400 border-green-500/30';
                case 'IMPROVE': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
                case 'REPLACE': return 'bg-red-500/10 text-red-400 border-red-500/30';
                case 'TEACHER_REVIEW': return 'bg-purple-500/10 text-purple-300 border-purple-500/30';
                case 'INCOMPLETE_REVIEW': return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
                default: return 'bg-slate-800 text-slate-400 border-slate-700';
            }
        };

        panel.innerHTML = `
            ${isStale ? `
                <div class="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl mb-4 text-xs text-amber-300 flex items-center justify-between">
                    <span><i class="fas fa-exclamation-circle mr-1.5 text-amber-400"></i> Notice: Examination content was edited after this review was generated.</span>
                    <button onclick="handleReviewAssessmentQuality()" class="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow">Re-run Quality Audit</button>
                </div>
            ` : ''}

            <div class="flex flex-wrap justify-between items-center gap-4 mb-6 border-b border-slate-800 pb-4">
                <div>
                    <h3 class="text-xl font-bold text-white flex items-center gap-2">
                        <i class="fas fa-microscope text-purple-400"></i> AI Quality Review Summary Report
                    </h3>
                    <p class="text-xs text-slate-400 mt-1">
                        Independent pedagogical audit performed via <strong class="text-blue-400">${report.reviewerModel}</strong>
                    </p>
                </div>
                <div class="flex gap-2">
                    <button onclick="AIReviewer.exportReviewReport()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all border border-slate-700 shadow flex items-center gap-1.5">
                        <i class="fas fa-file-download text-blue-400"></i> Export Review Report (JSON)
                    </button>
                </div>
            </div>

            <!-- Summary Badges Grid -->
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div class="p-3 bg-green-500/10 border border-green-500/20 rounded-2xl text-center">
                    <span class="text-2xl font-black text-green-400 block">${summary.keepCount}</span>
                    <span class="text-[10px] uppercase font-bold text-green-300 tracking-wider">KEEP</span>
                </div>
                <div class="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl text-center">
                    <span class="text-2xl font-black text-yellow-400 block">${summary.improveCount}</span>
                    <span class="text-[10px] uppercase font-bold text-yellow-300 tracking-wider">IMPROVE</span>
                </div>
                <div class="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-center">
                    <span class="text-2xl font-black text-red-400 block">${summary.replaceCount}</span>
                    <span class="text-[10px] uppercase font-bold text-red-300 tracking-wider">REPLACE</span>
                </div>
                <div class="p-3 bg-purple-500/10 border border-purple-500/20 rounded-2xl text-center">
                    <span class="text-2xl font-black text-purple-300 block">${summary.teacherReviewCount}</span>
                    <span class="text-[10px] uppercase font-bold text-purple-300 tracking-wider">TEACHER REVIEW</span>
                </div>
                <div class="p-3 bg-slate-800/80 border border-slate-700 rounded-2xl text-center">
                    <span class="text-2xl font-black text-slate-300 block">${summary.totalItems}</span>
                    <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">TOTAL REVIEWED</span>
                </div>
            </div>

            <!-- Detailed Quality Metrics Strip -->
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6 text-xs text-slate-400">
                <div class="p-2 bg-slate-900 rounded-xl border border-slate-800 text-center">
                    <span class="text-slate-500 block text-[9px] uppercase font-bold">Key Discrepancies</span>
                    <strong class="${summary.discrepancyCount > 0 ? 'text-red-400 font-bold' : 'text-slate-300'}">${summary.discrepancyCount || 0}</strong>
                </div>
                <div class="p-2 bg-slate-900 rounded-xl border border-slate-800 text-center">
                    <span class="text-slate-500 block text-[9px] uppercase font-bold">Rationale Mismatches</span>
                    <strong class="${(summary.rationaleOptionMappingErrorCount || summary.rationaleContradictionCount) > 0 ? 'text-red-400 font-bold' : 'text-slate-300'}">${summary.rationaleOptionMappingErrorCount || summary.rationaleContradictionCount || 0}</strong>
                </div>
                <div class="p-2 bg-slate-900 rounded-xl border border-slate-800 text-center">
                    <span class="text-slate-500 block text-[9px] uppercase font-bold">Weak Distractors</span>
                    <strong class="${summary.weakDistractorCount > 0 ? 'text-yellow-400 font-bold' : 'text-slate-300'}">${summary.weakDistractorCount || 0}</strong>
                </div>
                <div class="p-2 bg-slate-900 rounded-xl border border-slate-800 text-center">
                    <span class="text-slate-500 block text-[9px] uppercase font-bold">Answer Leakage</span>
                    <strong class="${summary.answerLeakageCount > 0 ? 'text-red-400 font-bold' : 'text-slate-300'}">${summary.answerLeakageCount || 0}</strong>
                </div>
                <div class="p-2 bg-slate-900 rounded-xl border border-slate-800 text-center">
                    <span class="text-slate-500 block text-[9px] uppercase font-bold">Cognitive Mismatches</span>
                    <strong class="${summary.cognitiveMismatchCount > 0 ? 'text-yellow-400 font-bold' : 'text-slate-300'}">${summary.cognitiveMismatchCount || 0}</strong>
                </div>
            </div>

            <!-- Targeted Regeneration Action Banner -->
            ${(() => {
                const actionableCount = (summary.improveCount || 0) + (summary.replaceCount || 0);
                if (isStale) return '';
                if (actionableCount > 0) {
                    return `
                        <div id="repair-action-banner" class="p-4 bg-purple-900/30 border border-purple-500/50 rounded-2xl mb-6 flex flex-wrap justify-between items-center gap-3">
                            <div>
                                <strong class="text-white text-sm block font-bold flex items-center gap-1.5">
                                    <i class="fas fa-tools text-purple-400"></i> Review-Guided Targeted Regeneration Available
                                </strong>
                                <p class="text-xs text-slate-300 mt-0.5">
                                    ${actionableCount} question(s) flagged for improvement. Click below to safely correct answer keys or generate targeted replacements. Approved questions remain 100% unchanged.
                                </p>
                            </div>
                            <button onclick="handleRepairDefectiveQuestions()" id="repair-defective-btn" class="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg flex items-center gap-2 transition-all cursor-pointer">
                                <i class="fas fa-magic text-purple-200"></i> Repair Defective Questions (${actionableCount})
                            </button>
                        </div>
                    `;
                } else {
                    return `
                        <div class="p-4 bg-green-900/30 border border-green-500/50 rounded-2xl mb-6 flex items-center gap-3">
                            <i class="fas fa-check-circle text-green-400 text-xl"></i>
                            <div>
                                <strong class="text-white text-sm font-bold block">All Questions Met Classroom-Ready Standards!</strong>
                                <p class="text-xs text-green-200">No questions require targeted regeneration. Your assessment is ready for printing or export.</p>
                            </div>
                        </div>
                    `;
                }
            })()}

            <!-- Examination-Wide Findings & Discrepancy Alerts -->
            ${(summary.discrepancyCount > 0 || summary.rationaleContradictionCount > 0 || summary.unreviewedCount > 0 || (report.examWideFindings && report.examWideFindings.length > 0)) ? `
                <div class="p-4 bg-red-900/30 border border-red-500/50 rounded-2xl mb-6 space-y-2">
                    <div class="font-bold text-red-400 text-xs flex items-center gap-1.5">
                        <i class="fas fa-exclamation-triangle"></i> Examination-Wide Findings & Critical Alerts
                    </div>
                    ${summary.unreviewedCount > 0 ? `<p class="text-xs text-amber-200">• <strong>Unreviewed Questions (${summary.unreviewedCount}):</strong> Some items were interrupted. Click 'Resume Review' to complete audit.</p>` : ''}
                    ${summary.discrepancyCount > 0 ? `<p class="text-xs text-red-200">• <strong>Answer Key Discrepancies (${summary.discrepancyCount}):</strong> Blind AI solver key differs from generator key.</p>` : ''}
                    ${summary.rationaleContradictionCount > 0 ? `<p class="text-xs text-red-200">• <strong>Rationale Position Contradictions (${summary.rationaleContradictionCount}):</strong> Rationale text references option letters that contradict current answer index.</p>` : ''}
                    ${(report.examWideFindings || []).map(f => `<p class="text-xs text-yellow-200">• <strong>${f.title}:</strong> ${f.explanation}</p>`).join('')}
                </div>
            ` : ''}

            <!-- Item-by-Item Review Cards -->
            <div class="space-y-4">
                <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Item-by-Item Pedagogical Audit</h4>
                ${report.itemReports.map((item, idx) => `
                    <div class="bg-slate-950/70 border border-slate-800 p-5 rounded-2xl">
                        <div class="flex flex-wrap justify-between items-start gap-2 mb-3">
                            <div class="flex items-center gap-2">
                                <span class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${statusBadgeColor(item.finalStatus)}">
                                    ${item.normalizedStatus || item.finalStatus}
                                </span>
                                <span class="text-xs font-bold text-slate-300">Q${idx + 1}. ${item.competency}</span>
                            </div>
                            <div class="text-[11px] text-slate-400 flex items-center gap-3">
                                <span>Generator Key: <strong class="text-white">${String.fromCharCode(65 + item.originalAnswerIndex)}</strong></span>
                                <span>Blind Reviewer Solved: <strong class="${item.answerKeyDiscrepancy ? 'text-red-400 font-black' : 'text-green-400'}">${item.solvedIndex !== null ? String.fromCharCode(65 + item.solvedIndex) : 'AMBIGUOUS'}</strong></span>
                            </div>
                        </div>

                        ${item.stimulus ? `
                            <div class="text-xs text-indigo-300 bg-indigo-950/40 p-2.5 rounded-xl border border-indigo-500/30 mb-2">
                                <strong class="text-[10px] text-indigo-400 uppercase font-bold block mb-0.5">STIMULUS</strong>
                                "${item.stimulus}"
                            </div>
                        ` : ''}
                        <p class="text-xs text-slate-200 font-medium mb-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                            <strong class="text-[10px] text-slate-400 uppercase font-bold block mb-0.5">QUESTION STEM</strong>
                            "${item.questionStem}"
                        </p>

                        <!-- Answer Comparison & Cognitive Level Summary -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-xs">
                            <div class="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                                <span class="text-[10px] text-slate-500 uppercase font-bold block mb-1">Answer Key Alignment</span>
                                ${item.answerKeyDiscrepancy ? `
                                    <span class="text-red-400 font-bold flex items-center gap-1">
                                        <i class="fas fa-times-circle"></i> Key Discrepancy (Generator: ${String.fromCharCode(65 + item.originalAnswerIndex)} vs Reviewer: ${item.solvedIndex !== null ? String.fromCharCode(65 + item.solvedIndex) : 'None'})
                                    </span>
                                ` : `
                                    <span class="text-green-400 font-bold flex items-center gap-1">
                                        <i class="fas fa-check-circle"></i> Confirmed Unique Correct Answer (${String.fromCharCode(65 + item.originalAnswerIndex)})
                                    </span>
                                `}
                            </div>
                            <div class="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                                <span class="text-[10px] text-slate-500 uppercase font-bold block mb-1">Cognitive Demand</span>
                                <span class="${item.cognitiveLevelMismatch ? 'text-yellow-400 font-bold' : 'text-slate-300'}">
                                    Declared: ${item.originalCognitiveLevel} | Actual Operation: ${item.actualCognitiveLevel}
                                </span>
                            </div>
                        </div>

                        <!-- Per-Option Distractor Assessment Table -->
                        ${(item.distractorAssessment && typeof item.distractorAssessment === 'object') ? `
                            <div class="mb-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs">
                                <span class="text-[10px] text-slate-500 uppercase font-bold block mb-2">Per-Option Quality Evaluation</span>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    ${[0, 1, 2, 3].map(optIdx => {
                                        const optEval = item.distractorAssessment[String(optIdx)] || item.distractorAssessment[optIdx];
                                        const isCorrect = optIdx === item.originalAnswerIndex;
                                        const optText = Array.isArray(item.options) ? item.options[optIdx] : '';
                                        return `
                                            <div class="p-2 rounded-lg border text-[11px] ${isCorrect ? 'bg-green-500/10 border-green-500/20 text-green-300' : (optEval?.plausible ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300')}">
                                                <strong>Option ${String.fromCharCode(65 + optIdx)}:</strong> "${(optText || '').substring(0, 40)}..."
                                                <div class="text-[10px] opacity-80 mt-0.5">
                                                    ${isCorrect ? '[Designated Correct Answer]' : (optEval?.plausible ? '✓ Plausible Distractor' : '⚠️ Weak/Absurd Distractor')} — ${optEval?.misconception || 'No evaluation.'}
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        ` : ''}

                        <!-- Issues & Pedagogical Findings -->
                        ${item.issues && item.issues.length > 0 ? `
                            <div class="space-y-2 mb-3">
                                <span class="text-[10px] text-slate-500 uppercase font-bold block">Identified Issues & Recommendations</span>
                                ${item.issues.map(iss => `
                                    <div class="p-2.5 rounded-xl border text-xs ${iss.severity === 'CRITICAL' ? 'bg-red-500/10 border-red-500/20 text-red-300' : (iss.severity === 'WARNING' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300' : 'bg-blue-500/10 border-blue-500/20 text-blue-300')}">
                                        <div class="font-bold flex items-center gap-1.5 mb-0.5">
                                            <i class="fas ${iss.severity === 'CRITICAL' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
                                            ${iss.criterion} [${iss.severity}]
                                        </div>
                                        <div>${iss.explanation}</div>
                                        ${iss.suggested_correction ? `<div class="mt-1 text-[11px] opacity-80"><strong>Recommendation:</strong> ${iss.suggested_correction}</div>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}

                        <div class="text-[11px] text-slate-400 pt-2 border-t border-slate-800/60">
                            <strong>Reviewer Summary:</strong> ${item.reviewerExplanation}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        container.innerHTML = '';
        container.appendChild(panel);
    },

    /**
     * Exports Quality Review Report as standalone JSON bundle.
     */
    exportReviewReport(reviewReport) {
        const report = reviewReport || this.currentReport;
        if (!report) return;

        const filename = `TestMaker_Quality_Review_Report_${(report.subjectName || 'Assessment').replace(/\s+/g, '-')}_${Date.now()}.json`;
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
