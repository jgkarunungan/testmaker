/**
 * AI REVIEWER MODULE (Phase 8.1.3 - Cognitive Calibration, MCQ Integrity & Quality Reviewer)
 * STRICTLY REVIEW-ONLY. DOES NOT MUTATE OR AUTOMATICALLY REWRITE EXAMINATIONS.
 */

const AIReviewer = {
    // Active review report for current examination snapshot
    currentReport: null,
    isReviewing: false,

    /**
     * Executes independent AI Quality Review on a generated examination snapshot.
     * Operates on a deep clone to ensure complete immutability of the source examination.
     */
    async reviewAssessment(resultsSnapshot, options = {}) {
        if (!resultsSnapshot || !Array.isArray(resultsSnapshot) || resultsSnapshot.length === 0) {
            throw new Error("No generated examination results available to review.");
        }

        const apiKey = options.apiKey || (typeof state !== 'undefined' ? state.apiKey : '');
        if (!apiKey) {
            throw new Error("API Key is required to run AI Quality Review. Please enter your key in Settings.");
        }

        const selectedModel = options.selectedModel || (typeof state !== 'undefined' ? state.selectedModel : 'gemini-3.5-flash-lite');
        const subjectName = resultsSnapshot[0]?.subjectName || 'General Assessment';
        const category = resultsSnapshot[0]?.category || 'A';

        // Deep clone snapshot to strictly protect original examination data from mutation
        const clonedSnapshot = JSON.parse(JSON.stringify(resultsSnapshot));

        // Flatten items with stable item identifiers
        const reviewBatchItems = [];
        const originalItemMap = new Map();

        clonedSnapshot.forEach((res, resIdx) => {
            const qs = (typeof AppLogic !== 'undefined' && typeof AppLogic.getQuestions === 'function')
                ? AppLogic.getQuestions(res)
                : (Array.isArray(res.questions) ? res.questions : (res.questions?.questions || []));

            qs.forEach((q, qIdx) => {
                const itemId = `c${resIdx}-q${qIdx}`;
                originalItemMap.set(itemId, {
                    resIdx,
                    qIdx,
                    competency: res.competency || 'General Competency',
                    notes: res.notes || '',
                    hours: res.hours || 1,
                    question: q
                });

                // BLIND QUESTION ITEM: Exclude answer_index, correct letter, and rationale!
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

        if (reviewBatchItems.length === 0) {
            throw new Error("Examination contains no question items to review.");
        }

        this.isReviewing = true;
        const totalItems = reviewBatchItems.length;

        // Process in manageable batches of 3-4 items
        const BATCH_SIZE = 4;
        const itemReviewMap = new Map();

        for (let i = 0; i < totalItems; i += BATCH_SIZE) {
            const batch = reviewBatchItems.slice(i, i + BATCH_SIZE);
            const prompt = this.buildBlindReviewBatchPrompt(batch, subjectName, category);

            if (typeof options.onProgress === 'function') {
                options.onProgress(i + 1, Math.min(i + BATCH_SIZE, totalItems), totalItems);
            }

            try {
                const modelObj = (typeof getModelConfig === 'function') ? getModelConfig(selectedModel) : { name: selectedModel };
                const aiResult = await executeAiRequest(apiKey, prompt, [modelObj], 'high');

                if (aiResult && aiResult.success && aiResult.text) {
                    const parsedObj = this.extractAndParseReviewJSON(aiResult.text);
                    const reviewsArray = parsedObj.reviews || parsedObj.items || (Array.isArray(parsedObj) ? parsedObj : []);

                    reviewsArray.forEach(rev => {
                        if (rev && rev.item_id) {
                            itemReviewMap.set(rev.item_id, rev);
                        }
                    });
                }
            } catch (err) {
                console.warn(`Review batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
            }
        }

        // Combine AI review findings with local deterministic checks & discrepancy analysis
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

        const allQuestionsList = Array.from(originalItemMap.values()).map(o => o.question);

        originalItemMap.forEach((origObj, itemId) => {
            const origQuestion = origObj.question;
            const aiReview = itemReviewMap.get(itemId) || null;

            if (!aiReview) {
                itemReports.push({
                    itemId,
                    competency: origObj.competency,
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
                    issues: [{ criterion: "Review Interrupted", severity: "WARNING", explanation: "Item review was not completed due to network or timeout error.", suggested_correction: "Re-run review for complete assessment coverage." }],
                    reviewerExplanation: "Unreviewed item due to batch processing interruption."
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
                competency: origObj.competency,
                questionStem: origQuestion.question,
                options: origQuestion.options,
                originalAnswerIndex: origQuestion.answer_index,
                originalCognitiveLevel: origQuestion.cognitive_level,
                originalRationale: origQuestion.rationale || '',
                ...processedReview
            });
        });

        // Perform Examination-Wide Checks across all items
        const examWideFindings = this.performExaminationWideChecks(itemReports, category);

        this.isReviewing = false;
        this.currentReport = {
            reviewedAt: new Date().toISOString(),
            subjectName,
            category,
            reviewerModel: selectedModel,
            summary: {
                totalItems,
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
                rationaleContradictionCount
            },
            examWideFindings,
            itemReports
        };

        return this.currentReport;
    },

    /**
     * Builds the Calibrated Blind Review Batch Prompt (Phase 8.1.3).
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
${JSON.stringify(itemsBatch, null, 2)}
`;
    },

    extractAndParseReviewJSON(text) {
        let clean = text.trim();
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            clean = clean.substring(start, end + 1);
        }
        try {
            return JSON.parse(clean);
        } catch (e) {
            return { reviews: [] };
        }
    },

    /**
     * Post-processes AI review findings with application-side discrepancy analysis, rationale checks, and hard failure enforcement.
     */
    applyHardFailureRulesAndDiscrepancies(aiReview, origQuestion, allQuestionsList) {
        const issues = Array.isArray(aiReview.issues) ? [...aiReview.issues] : [];

        let normalizedStatus = (aiReview.recommended_status || 'TEACHER_REVIEW').toUpperCase();
        if (!['KEEP', 'IMPROVE_TOO_TRIVIAL', 'IMPROVE_TOO_DIFFICULT', 'IMPROVE_COGNITIVE_MISMATCH', 'IMPROVE_OTHER', 'IMPROVE', 'REPLACE', 'TEACHER_REVIEW'].includes(normalizedStatus)) {
            normalizedStatus = 'TEACHER_REVIEW';
        }

        // Map normalized status to primary UI status (KEEP, IMPROVE, REPLACE, TEACHER_REVIEW, INCOMPLETE_REVIEW)
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
        const solvedIndex = (Number.isInteger(aiReview.independent_best_answer_index) && aiReview.independent_best_answer_index >= 0 && aiReview.independent_best_answer_index <= 3)
            ? aiReview.independent_best_answer_index
            : null;

        const defensibleIndices = Array.isArray(aiReview.defensible_answer_indices) ? aiReview.defensible_answer_indices : [];
        const answerKeyDiscrepancy = (solvedIndex !== null && solvedIndex !== origQuestion.answer_index);

        if (answerKeyDiscrepancy) {
            issues.unshift({
                criterion: "Answer Key Discrepancy",
                severity: "CRITICAL",
                explanation: `Blind AI Reviewer selected Option ${String.fromCharCode(65 + solvedIndex)} as defensible, but generator key is Option ${String.fromCharCode(65 + origQuestion.answer_index)}.`,
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
                severity: "WARNING",
                explanation: `Declared cognitive level is "${origQuestion.cognitive_level}", but actual required mental operation is "${actualLevel}".`,
                suggested_correction: "Update cognitive level label or adjust question cognitive demand."
            });
        }

        // 6. Mandatory Rationale Validation (Position Contradiction Check)
        let rationaleContradiction = false;
        const rationaleText = origQuestion.rationale || '';
        if (rationaleText.trim().length > 0) {
            // Match phrases like "Option A is correct", "Choice C is the answer", "Letter B"
            const matchLetter = rationaleText.match(/\b(?:option|choice|letter)\s+([a-d])\b/i);
            if (matchLetter && matchLetter[1]) {
                const referencedLetterIdx = matchLetter[1].toUpperCase().charCodeAt(0) - 65;
                if (referencedLetterIdx !== origQuestion.answer_index) {
                    rationaleContradiction = true;
                    issues.unshift({
                        criterion: "Rationale Position Contradiction",
                        severity: "CRITICAL",
                        explanation: `Rationale text references Option ${matchLetter[1].toUpperCase()}, which contradicts the recorded answer key position (Option ${String.fromCharCode(65 + origQuestion.answer_index)}).`,
                        suggested_correction: "Revise rationale to describe answer content rather than option position letters."
                    });
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
                if (warn.includes("All/None") || warn.includes("distractor") || warn.includes("identical")) {
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

        // 8. HARD FAILURE RULE ENFORCEMENT
        // An item MUST NOT receive KEEP if it has critical defects, answer key discrepancies, or rationale contradictions!
        const hasCriticalIssue = issues.some(i => i.severity === 'CRITICAL') || answerKeyDiscrepancy || defensibleIndices.length !== 1 || answerLeakage || rationaleContradiction || !hasFourOptions;

        if (finalStatus === 'KEEP' && hasCriticalIssue) {
            finalStatus = (defensibleIndices.length !== 1 || answerKeyDiscrepancy || !hasFourOptions) ? 'REPLACE' : 'IMPROVE';
            if (normalizedStatus === 'KEEP') normalizedStatus = 'IMPROVE_OTHER';
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

        return warnings;
    },

    /**
     * Renders the Quality Review Summary Panel and Item Cards in UI.
     */
    renderReviewReportUI(container, report) {
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
            <div class="flex flex-wrap justify-between items-center gap-4 mb-6 border-b border-slate-800 pb-4">
                <div>
                    <h3 class="text-xl font-bold text-white flex items-center gap-2">
                        <i class="fas fa-microscope text-purple-400"></i> AI Quality Review Summary Report (Phase 8.1.3)
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
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
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

            <!-- Examination-Wide Findings & Discrepancy Alerts -->
            ${(summary.discrepancyCount > 0 || summary.rationaleContradictionCount > 0 || (report.examWideFindings && report.examWideFindings.length > 0)) ? `
                <div class="p-4 bg-red-900/30 border border-red-500/50 rounded-2xl mb-6 space-y-2">
                    <div class="font-bold text-red-400 text-xs flex items-center gap-1.5">
                        <i class="fas fa-exclamation-triangle"></i> Examination-Wide Findings & Critical Alerts
                    </div>
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

                        <p class="text-xs text-slate-300 italic mb-3 bg-slate-900/50 p-2.5 rounded-xl border border-slate-800">
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
