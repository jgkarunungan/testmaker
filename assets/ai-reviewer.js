/**
 * AI REVIEWER MODULE (Phase 8.1 - Independent AI Quality Reviewer)
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

        let discrepancyCount = 0;
        let cognitiveMismatchCount = 0;
        let weakDistractorCount = 0;
        let answerLeakageCount = 0;
        let conceptOverlapCount = 0;

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

            switch (processedReview.finalStatus) {
                case "KEEP": keepCount++; break;
                case "IMPROVE": improveCount++; break;
                case "REPLACE": replaceCount++; break;
                case "TEACHER_REVIEW": teacherReviewCount++; break;
            }

            itemReports.push({
                itemId,
                competency: origObj.competency,
                questionStem: origQuestion.question,
                options: origQuestion.options,
                originalAnswerIndex: origQuestion.answer_index,
                originalCognitiveLevel: origQuestion.cognitive_level,
                ...processedReview
            });
        });

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
                discrepancyCount,
                cognitiveMismatchCount,
                weakDistractorCount,
                answerLeakageCount,
                conceptOverlapCount
            },
            itemReports
        };

        return this.currentReport;
    },

    /**
     * Builds the Blind Review Batch Prompt.
     * EXCLUDES answer_index, correct letter, and rationale.
     */
    buildBlindReviewBatchPrompt(itemsBatch, subjectName, category) {
        return `
Act as an Independent Master Educational Assessment Auditor and Curriculum Review Specialist in ${subjectName}.

CRITICAL BLIND EVALUATION DIRECTIVE:
You are reviewing multiple-choice test items generated for Category ${category} Senior High School students.
You are NOT given the designated answer key or rationale.
You MUST analyze each question BLINDLY and solve it independently using ONLY the provided question text, options, competency, and teacher notes.

PEDAGOGICAL & ASSESSMENT EVALUATION STANDARDS:
1. INDEPENDENT ANSWER VERIFICATION:
   - Solve the question independently without guessing or making unsupported assumptions.
   - Identify the option index (0, 1, 2, or 3) that is unambiguously and defensibly correct based strictly on taught material.
   - If EXACTLY ONE option is correct, set independent_best_answer_index to that index (0..3) and defensible_answer_indices to [index].
   - If MULTIPLE options are defensibly correct, set independent_best_answer_index to null and defensible_answer_indices to all defensible indices (e.g. [0, 2]).
   - If NO option is defensibly correct, set independent_best_answer_index to null and defensible_answer_indices to [].
   - Set answer_uniqueness_status to "UNIQUE_CORRECT", "MULTIPLE_DEFENSIBLE", "NO_DEFENSIBLE", or "INSUFFICIENT_INFORMATION".

2. DISTRACTOR PLAUSIBILITY & CREDIBILITY:
   - Evaluate EACH of the 3 incorrect options.
   - A strong distractor must represent a believable student misconception, realistic misapplication, or incomplete reasoning.
   - Flag distractors that are absurd, completely unrelated, mere opposites, or easily dismissible without subject knowledge.

3. REVISED BLOOM'S TAXONOMY RIGOR:
   - Classify actual_cognitive_level (Remembering, Understanding, Applying, Analyzing, Evaluating) based SOLELY on the required mental operation, NOT action verbs.
   - Flag "False HOTS" where a factual recall item is falsely labeled as Analyzing or Evaluating.

4. LEARNING WHILE TESTING & STIMULUS DESIGN:
   - Check if the stem begins with an educational lead-in stimulus.
   - Flag answer leakage if the stimulus states or strongly paraphrases the correct answer text.

5. STEM CLARITY & TASK DEFINITION:
   - Verify that the stem defines a clear, unambiguous task for the student.

6. TEACHER GUIDANCE & INSTRUCTIONAL SCOPE:
   - Verify that all required concepts remain strictly within the provided teacher AI guidance & notes.

7. ITEM RECOMMENDATION STATUS:
   - "KEEP": No essential defects found. Unique correct answer, credible distractors, clear stimulus, appropriate cognitive level, within notes scope.
   - "IMPROVE": Minor repairable defects (e.g. weak distractors, option length giveaway, short stem, minor scope drift).
   - "REPLACE": Fundamental validity defects (e.g. multiple correct answers, no correct answer, factual error, severe answer leakage, missing task).
   - "TEACHER_REVIEW": Ambiguous domain logic or uncertain cognitive ceiling requiring human judgment.

HARD FAILURE RULE FOR "KEEP":
You MUST NOT assign "KEEP" if an item has multiple correct answers, no correct answer, factual error, severe answer leakage, or untaught scope violation.

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
      "competency_alignment": true,
      "instructional_coverage": true,
      "language_consistency": true,
      "stimulus_quality": "STRONG",
      "stem_clarity": "CLEAR",
      "option_length_warning": false,
      "concept_overlap_warning": false,
      "recommended_status": "KEEP",
      "issues": [
        {
          "criterion": "Distractor Plausibility",
          "severity": "WARNING",
          "explanation": "Option C is obviously absurd.",
          "suggested_correction": "Replace Option C with a plausible misconception regarding..."
        }
      ],
      "reviewer_explanation": "Concise summary of findings.",
      "review_uncertainty": "LOW"
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
     * Post-processes AI review findings with application-side discrepancy analysis & hard failure enforcement.
     */
    applyHardFailureRulesAndDiscrepancies(aiReview, origQuestion, allQuestionsList) {
        const issues = Array.isArray(aiReview.issues) ? [...aiReview.issues] : [];
        let recommendedStatus = (aiReview.recommended_status || 'TEACHER_REVIEW').toUpperCase();
        if (!['KEEP', 'IMPROVE', 'REPLACE', 'TEACHER_REVIEW'].includes(recommendedStatus)) {
            recommendedStatus = 'TEACHER_REVIEW';
        }

        // 1. Blind Answer Key Comparison
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

        // 2. Answer Uniqueness Check
        const uniquenessStatus = aiReview.answer_uniqueness_status || 'UNIQUE_CORRECT';
        if (uniquenessStatus !== 'UNIQUE_CORRECT' || defensibleIndices.length !== 1) {
            issues.unshift({
                criterion: "Answer Uniqueness Failure",
                severity: "CRITICAL",
                explanation: `Question does not have exactly one defensibly correct answer (status: ${uniquenessStatus}, defensible choices: [${defensibleIndices.map(i => String.fromCharCode(65+i)).join(', ')}]).`,
                suggested_correction: "Revise options so that exactly one option is correct."
            });
        }

        // 3. Cognitive Level Comparison
        const actualLevel = aiReview.actual_cognitive_level || origQuestion.cognitive_level || 'Remembering';
        const cognitiveLevelMismatch = (actualLevel !== origQuestion.cognitive_level);
        if (cognitiveLevelMismatch) {
            issues.push({
                criterion: "Cognitive Level Mismatch",
                severity: "WARNING",
                explanation: `Declared cognitive level is "${origQuestion.cognitive_level}", but actual mental operation requires "${actualLevel}".`,
                suggested_correction: "Update cognitive level label or adjust question cognitive demand."
            });
        }

        // 4. Local Deterministic Heuristic Checks Integration
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

        // 5. HARD FAILURE RULE ENFORCEMENT
        // An item MUST NOT receive KEEP if it has critical defects or answer key discrepancies!
        const hasCriticalIssue = issues.some(i => i.severity === 'CRITICAL') || answerKeyDiscrepancy || defensibleIndices.length !== 1 || answerLeakage;

        if (recommendedStatus === 'KEEP' && hasCriticalIssue) {
            recommendedStatus = (defensibleIndices.length !== 1 || answerKeyDiscrepancy) ? 'REPLACE' : 'IMPROVE';
        }

        return {
            finalStatus: recommendedStatus,
            solvedIndex,
            defensibleIndices,
            uniquenessStatus,
            answerKeyDiscrepancy,
            actualCognitiveLevel: actualLevel,
            cognitiveLevelMismatch,
            weakDistractors,
            answerLeakage,
            conceptOverlap,
            stimulusQuality: aiReview.stimulus_quality || 'STRONG',
            stemClarity: aiReview.stem_clarity || 'CLEAR',
            distractorAssessment: aiReview.distractor_assessment || null,
            issues,
            reviewerExplanation: aiReview.reviewer_explanation || "Reviewed by AI."
        };
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
                default: return 'bg-slate-800 text-slate-400 border-slate-700';
            }
        };

        panel.innerHTML = `
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

            <!-- Discrepancy & Critical Findings Notice -->
            ${summary.discrepancyCount > 0 ? `
                <div class="p-4 bg-red-900/30 border border-red-500/50 rounded-2xl mb-6 flex items-start gap-3">
                    <i class="fas fa-exclamation-triangle text-red-400 text-lg mt-0.5"></i>
                    <div class="text-xs text-red-200">
                        <strong class="text-red-400 font-bold block text-sm mb-0.5">Answer Key Discrepancies Detected (${summary.discrepancyCount})</strong>
                        The independent blind AI solver arrived at a different defensible answer than the generator's designated key. Review these items carefully before administering the test.
                    </div>
                </div>
            ` : ''}

            <!-- Item-by-Item Review Accordion / Cards -->
            <div class="space-y-4">
                <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Item-by-Item Pedagogical Audit</h4>
                ${report.itemReports.map((item, idx) => `
                    <div class="bg-slate-950/70 border border-slate-800 p-5 rounded-2xl">
                        <div class="flex flex-wrap justify-between items-start gap-2 mb-3">
                            <div class="flex items-center gap-2">
                                <span class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${statusBadgeColor(item.finalStatus)}">
                                    ${item.finalStatus}
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
