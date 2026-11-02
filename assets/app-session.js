/**
 * APP SESSION & BLUEPRINT MODULE (Phase 8.1.2)
 * Manages deterministic examination blueprints, micro-batch sessions, durable persistence, Pause/Resume/Cancel.
 */

const AppSession = {
    activeSession: null,

    /**
     * Creates a deterministic blueprint for the requested total items and target competencies.
     */
    createBlueprint(targetCompetencies, totalExamItems, category, explicitBloomAllocations) {
        if (!Array.isArray(targetCompetencies) || targetCompetencies.length === 0) {
            throw new Error("No competencies selected for examination generation.");
        }

        const tosResult = AppLogic.calculateTOSDistribution(targetCompetencies, totalExamItems);
        if (!tosResult.isValid) {
            throw new Error(tosResult.error);
        }

        const counts = tosResult.counts;

        // Build empty slots per competency matching Largest Remainder item counts
        const blueprintSlots = [];
        let globalIndex = 0;

        targetCompetencies.forEach((comp, compIdx) => {
            const allocatedCount = counts[compIdx];
            const compBloomMap = comp.bloomAllocations || (explicitBloomAllocations ? explicitBloomAllocations[compIdx] : null);

            let slotBloomLevels = [];
            if (compBloomMap) {
                Object.keys(compBloomMap).forEach(lvl => {
                    const cnt = compBloomMap[lvl] || 0;
                    for (let b = 0; b < cnt; b++) slotBloomLevels.push(lvl);
                });
            }

            for (let slotIdx = 0; slotIdx < allocatedCount; slotIdx++) {
                const assignedBloom = slotBloomLevels[slotIdx] || 'Remembering';
                blueprintSlots.push({
                    slotId: `slot_c${compIdx}_s${slotIdx}`,
                    globalSlotIndex: globalIndex++,
                    competencyIndex: compIdx,
                    competencyTitle: comp.title,
                    notes: comp.notes || '',
                    hours: comp.hours || 1,
                    slotIndexInCompetency: slotIdx,
                    plannedBloomLevel: assignedBloom,
                    status: 'PENDING',
                    repairAttempts: 0,
                    repairHistory: [],
                    acceptedQuestion: null
                });
            }
        });

        // If no explicit Bloom allocations were provided, apply standard category cognitive distribution
        const hasExplicitAllocations = targetCompetencies.some((c, idx) => c.bloomAllocations || (explicitBloomAllocations && explicitBloomAllocations[idx]));
        if (!hasExplicitAllocations) {
            const globalCogDist = AppLogic.calculateCognitiveDistribution(totalExamItems, category);
            let globalEvaluating = globalCogDist.evaluating;
            let globalAnalyzing = globalCogDist.analyzing;

            let evalAssigned = 0;
            for (let i = 0; i < blueprintSlots.length && evalAssigned < globalEvaluating; i++) {
                blueprintSlots[i].plannedBloomLevel = 'Evaluating';
                evalAssigned++;
            }

            let analyzingAssigned = 0;
            for (let i = evalAssigned; i < blueprintSlots.length && analyzingAssigned < globalAnalyzing; i++) {
                blueprintSlots[i].plannedBloomLevel = 'Analyzing';
                analyzingAssigned++;
            }

            const lotsStart = evalAssigned + analyzingAssigned;
            for (let i = lotsStart; i < blueprintSlots.length; i++) {
                const lotsIdx = (i - lotsStart) % 3;
                if (lotsIdx === 0) blueprintSlots[i].plannedBloomLevel = 'Remembering';
                else if (lotsIdx === 1) blueprintSlots[i].plannedBloomLevel = 'Understanding';
                else blueprintSlots[i].plannedBloomLevel = 'Applying';
            }
        }

        return {
            totalItems: totalExamItems,
            category: category,
            slots: blueprintSlots,
            countsByCompetency: counts
        };
    },

    /**
     * Starts or initializes a new durable generation session.
     */
    createSession(subject, targetCompetencies, totalExamItems, category, examTitle, model, thinkingLevel) {
        const blueprint = this.createBlueprint(targetCompetencies, totalExamItems, category);

        const session = {
            sessionId: `sess_${Date.now()}_${Math.floor(Math.random()*1000)}`,
            status: 'IN_PROGRESS', // IN_PROGRESS | PAUSED | COMPLETED | FAILED
            subjectName: subject.name,
            examTitle: examTitle || 'Assessment',
            category: category,
            totalRequestedItems: totalExamItems,
            lockedModel: model || 'gemini-3.5-flash-lite',
            lockedThinkingLevel: thinkingLevel || 'high',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            blueprintSlots: blueprint.slots,
            currentCompetencyIndex: 0,
            batchSize: 2, // Default 2 items per micro-batch
            retryCount: 0,
            lastError: null
        };

        this.activeSession = session;
        this.saveSession();
        return session;
    },

    saveSession() {
        if (!this.activeSession) return;
        this.activeSession.updatedAt = new Date().toISOString();
        try {
            localStorage.setItem('testmaker_active_generation_session', JSON.stringify(this.activeSession));
        } catch (e) {
            console.error('Failed to persist generation session to localStorage:', e);
        }
    },

    loadSavedSession() {
        try {
            const saved = localStorage.getItem('testmaker_active_generation_session');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && parsed.status && parsed.blueprintSlots) {
                    this.activeSession = parsed;
                    return parsed;
                }
            }
        } catch (e) {}
        return null;
    },

    clearSession() {
        this.activeSession = null;
        localStorage.removeItem('testmaker_active_generation_session');
        localStorage.removeItem('generation_session_lock');
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
    },

    /**
     * Validates a returned micro-batch of generated question items.
     */
    validateBatchResponse(parsedData, targetSlots) {
        const questions = AppLogic.getQuestions({ questions: parsedData });
        if (!Array.isArray(questions) || questions.length === 0) {
            return { isValid: false, error: 'AI response contained no question items.' };
        }

        const validQuestions = [];
        const validatedSlots = [];

        for (let i = 0; i < Math.min(questions.length, targetSlots.length); i++) {
            const q = questions[i];
            const slot = targetSlots[i];
            const val = this.validateGeneratedSlot(slot, q);
            if (val.isValid) {
                validQuestions.push(val.question);
                validatedSlots.push(slot);
            } else {
                return { isValid: false, error: `Item ${i+1} validation failed: ${val.error}` };
            }
        }

        return { isValid: true, questions: validQuestions, targetSlots: validatedSlots };
    },

    /**
     * Pre-acceptance Generation Gate: Validates a single generated slot question against its authoritative blueprint.
     */
    validateGeneratedSlot(slot, question) {
        if (!slot || !question) return { isValid: false, error: "Missing slot or question data." };

        // 1. Schema Validation via AppLogic.validateQuestion
        const schemaVal = AppLogic.validateQuestion(question);
        if (!schemaVal.isValid) return schemaVal;

        // 2. Duplicate Normalized Option Check
        const normalizedOpts = question.options.map(o => (typeof o === 'string' ? o.trim().toLowerCase().replace(/[^\w]/g, '') : ''));
        if (new Set(normalizedOpts).size < 4) {
            return { isValid: false, error: "Duplicate or near-identical option choices detected in item." };
        }

        // 3. Authoritative Competency & Bloom Enforcement
        question.competencyIndex = slot.competencyIndex;
        question.competencyTitle = slot.competencyTitle;
        question.plannedBloomLevel = slot.plannedBloomLevel;
        question.slotId = slot.slotId;

        // Ensure stable option IDs
        if (!Array.isArray(question.option_ids) || question.option_ids.length !== 4) {
            question.option_ids = ['opt_0', 'opt_1', 'opt_2', 'opt_3'];
        }

        return { isValid: true, question };
    },

    /**
     * Commits accepted batch items atomically to session blueprint slots.
     */
    commitAcceptedBatch(targetSlots, acceptedQuestions) {
        if (!this.activeSession) return;

        targetSlots.forEach((slot, idx) => {
            const q = acceptedQuestions[idx];
            // Ensure cognitive level matches slot
            if (slot.plannedBloomLevel) {
                q.cognitive_level = slot.plannedBloomLevel;
            }

            const sessionSlot = this.activeSession.blueprintSlots.find(s => s.slotId === slot.slotId);
            if (sessionSlot) {
                sessionSlot.status = 'ACCEPTED';
                sessionSlot.acceptedQuestion = q;
            }
        });

        this.activeSession.retryCount = 0;
        this.activeSession.lastError = null;

        // Check if all slots are completed
        const pendingCount = this.activeSession.blueprintSlots.filter(s => s.status !== 'ACCEPTED').length;
        if (pendingCount === 0) {
            this.activeSession.status = 'COMPLETED';
        }

        this.saveSession();
    },

    /**
     * Performs safe answer key correction for items where blind solver & rationale agree and stem is valid.
     */
    performSafeKeyCorrections(session, itemReports) {
        if (!session || !Array.isArray(session.blueprintSlots) || !Array.isArray(itemReports)) return 0;

        let correctedCount = 0;
        itemReports.forEach(report => {
            if (report.decision === 'IMPROVE' || report.decision === 'REPLACE') {
                const slot = session.blueprintSlots.find(s => s.slotId === report.slotId || s.slotId === report.itemId);
                if (slot && slot.acceptedQuestion) {
                    const q = slot.acceptedQuestion;
                    const blindSolvedIndex = report.independentBestAnswerIndex;
                    const hasValidSolvedIndex = Number.isInteger(blindSolvedIndex) && blindSolvedIndex >= 0 && blindSolvedIndex <= 3;
                    const noFormatError = Array.isArray(q.options) && q.options.length === 4 && new Set(q.options.map(o => (o||'').trim().toLowerCase())).size === 4;
                    const bloomMatches = (report.independentlyAssessedCognitiveLevel === slot.plannedBloomLevel);
                    const noRationaleContradiction = !report.rationaleFindings?.rationale_position_contradiction && !report.rationaleFindings?.key_discrepancy;

                    if (hasValidSolvedIndex && noFormatError && bloomMatches && noRationaleContradiction && blindSolvedIndex !== q.answer_index) {
                        const oldIdx = q.answer_index;
                        q.answer_index = blindSolvedIndex;
                        if (q.rationale_details && Array.isArray(q.option_ids)) {
                            q.rationale_details.correct_option_id = q.option_ids[blindSolvedIndex];
                        }

                        slot.actionStatus = "KEY_CORRECTED";
                        slot.repairHistory.push({
                            attemptNumber: slot.repairAttempts,
                            action: "SAFE_KEY_CORRECTED",
                            oldAnswerIndex: oldIdx,
                            newAnswerIndex: blindSolvedIndex,
                            timestamp: new Date().toISOString()
                        });

                        report.decision = "PASS";
                        report.actionTaken = "SAFE_KEY_CORRECTED";
                        correctedCount++;
                    }
                }
            }
        });

        this.saveSession();
        return correctedCount;
    },

    /**
     * Filters pending slots that require targeted replacement generation (repairAttempts < 2).
     */
    getPendingReplacementSlots(session, itemReports) {
        if (!session || !Array.isArray(session.blueprintSlots) || !Array.isArray(itemReports)) return [];

        const pendingSlots = [];
        itemReports.forEach(report => {
            if (report.decision === 'IMPROVE' || report.decision === 'REPLACE') {
                const slot = session.blueprintSlots.find(s => s.slotId === report.slotId || s.slotId === report.itemId);
                if (slot && (slot.repairAttempts || 0) < 2) {
                    slot.rejectionFinding = report.issues ? report.issues.join(' | ') : "Failed quality review.";
                    pendingSlots.push(slot);
                } else if (slot && (slot.repairAttempts || 0) >= 2) {
                    slot.status = 'TEACHER_REVIEW';
                    slot.actionStatus = 'TEACHER_REVIEW_ESCALATED';
                }
            }
        });

        return pendingSlots;
    },

    /**
     * Commits replacement candidates and updates repair attempts and slot statuses.
     */
    commitReplacementBatch(targetSlots, replacementQuestions, reviewerReports = []) {
        if (!this.activeSession) return;

        targetSlots.forEach((slot, idx) => {
            const newQ = replacementQuestions[idx];
            const sessionSlot = this.activeSession.blueprintSlots.find(s => s.slotId === slot.slotId);
            if (!sessionSlot || !newQ) return;

            sessionSlot.repairAttempts = (sessionSlot.repairAttempts || 0) + 1;
            const report = reviewerReports.find(r => r.itemId === slot.slotId || r.slotId === slot.slotId) || {};

            sessionSlot.repairHistory.push({
                attemptNumber: sessionSlot.repairAttempts,
                candidateQuestion: JSON.parse(JSON.stringify(newQ)),
                reviewDecision: report.decision || "PENDING",
                issues: report.issues || [],
                timestamp: new Date().toISOString()
            });

            if (report.decision === 'PASS' || report.decision === 'KEEP' || report.decision === 'WARNING' || !report.decision) {
                sessionSlot.status = 'ACCEPTED';
                sessionSlot.acceptedQuestion = newQ;
                sessionSlot.actionStatus = 'REPLACEMENT_ACCEPTED';
            } else if (sessionSlot.repairAttempts >= 2) {
                sessionSlot.status = 'TEACHER_REVIEW';
                sessionSlot.acceptedQuestion = newQ; // Retain latest candidate for teacher review
                sessionSlot.actionStatus = 'TEACHER_REVIEW_ESCALATED';
            } else {
                sessionSlot.status = 'PENDING_REPLACEMENT';
            }
        });

        this.saveSession();
    },

    /**
     * Assembles final assessment combining PASS, WARNING, Key-Corrected, Replacements, and Escalated Teacher-Review slots.
     */
    finalizeAssessmentAssembly(session) {
        const targetSession = session || this.activeSession;
        if (!targetSession || !Array.isArray(targetSession.blueprintSlots)) return null;

        const slots = targetSession.blueprintSlots;
        const compMap = new Map();

        slots.forEach(slot => {
            if (!compMap.has(slot.competencyTitle)) {
                compMap.set(slot.competencyTitle, {
                    competency: slot.competencyTitle,
                    notes: slot.notes,
                    hours: slot.hours,
                    questions: []
                });
            }
            const q = slot.acceptedQuestion || {
                question: `[SLOT UNRESOLVED - TEACHER REVIEW REQUIRED] ${slot.slotId}`,
                options: ["Option A", "Option B", "Option C", "Option D"],
                answer_index: 0,
                cognitive_level: slot.plannedBloomLevel,
                rationale: "Unresolved slot requiring teacher review."
            };
            q.slotId = slot.slotId;
            q.slotStatus = slot.status;
            q.actionStatus = slot.actionStatus || slot.status;
            compMap.get(slot.competencyTitle).questions.push(q);
        });

        return Array.from(compMap.values());
    },

    /**
     * Assembles final examination results array once all blueprint slots are ACCEPTED.
     */
    assembleFinalResults() {
        if (!this.activeSession) return null;

        const slots = this.activeSession.blueprintSlots;
        const pending = slots.filter(s => s.status !== 'ACCEPTED');
        if (pending.length > 0) {
            throw new Error(`Cannot assemble incomplete examination. ${pending.length} slots remain unfinished.`);
        }

        // Group slots by competency title preserving original competency ordering
        const compMap = new Map();
        slots.forEach(slot => {
            if (!compMap.has(slot.competencyTitle)) {
                compMap.set(slot.competencyTitle, {
                    competency: slot.competencyTitle,
                    notes: slot.notes,
                    hours: slot.hours,
                    questions: []
                });
            }
            compMap.get(slot.competencyTitle).questions.push(slot.acceptedQuestion);
        });

        const results = Array.from(compMap.values()).map(compGroup => ({
            competency: compGroup.competency,
            notes: compGroup.notes,
            hours: compGroup.hours,
            questions: compGroup.questions,
            category: this.activeSession.category,
            subjectName: this.activeSession.subjectName,
            examTitle: this.activeSession.examTitle,
            requestedModel: this.activeSession.lockedModel,
            generatingModel: this.activeSession.lockedModel,
            thinkingLevel: this.activeSession.lockedThinkingLevel,
            generatedAt: new Date().toISOString(),
            assessmentStatus: 'Complete',
            totalRequested: this.activeSession.totalRequestedItems,
            totalActual: slots.length
        }));

        // Whole-examination A/B/C/D correct answer position balancing across ALL questions
        AppLogic.balanceAssessmentAnswers(results);

        return results;
    }
};
