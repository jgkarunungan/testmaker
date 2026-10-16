/**
 * APP SESSION & BLUEPRINT MODULE (Phase 8.1.2)
 * Manages deterministic examination blueprints, micro-batch sessions, durable persistence, Pause/Resume/Cancel.
 */

const AppSession = {
    activeSession: null,

    /**
     * Creates a deterministic blueprint for the requested total items and target competencies.
     */
    createBlueprint(targetCompetencies, totalExamItems, category) {
        if (!Array.isArray(targetCompetencies) || targetCompetencies.length === 0) {
            throw new Error("No competencies selected for examination generation.");
        }

        const tosResult = AppLogic.calculateTOSDistribution(targetCompetencies, totalExamItems);
        if (!tosResult.isValid) {
            throw new Error(tosResult.error);
        }

        const counts = tosResult.counts;

        // 1. Calculate overall examination-wide cognitive target distribution (60% LOTS, 30% Analyzing, 10% Evaluating)
        const globalCogDist = AppLogic.calculateCognitiveDistribution(totalExamItems, category);
        let globalAnalyzing = globalCogDist.analyzing;
        let globalEvaluating = globalCogDist.evaluating;

        // 2. Build empty slots per competency matching Largest Remainder item counts
        const blueprintSlots = [];
        let globalIndex = 0;

        targetCompetencies.forEach((comp, compIdx) => {
            const allocatedCount = counts[compIdx];
            for (let slotIdx = 0; slotIdx < allocatedCount; slotIdx++) {
                blueprintSlots.push({
                    slotId: `slot_c${compIdx}_s${slotIdx}`,
                    globalSlotIndex: globalIndex++,
                    competencyIndex: compIdx,
                    competencyTitle: comp.title,
                    notes: comp.notes || '',
                    hours: comp.hours || 1,
                    slotIndexInCompetency: slotIdx,
                    plannedBloomLevel: 'Remembering', // Default, will be assigned below
                    status: 'PENDING',
                    acceptedQuestion: null
                });
            }
        });

        // 3. Assign global Evaluating slots across competencies (up to globalEvaluating)
        let evalAssigned = 0;
        for (let i = 0; i < blueprintSlots.length && evalAssigned < globalEvaluating; i++) {
            blueprintSlots[i].plannedBloomLevel = 'Evaluating';
            evalAssigned++;
        }

        // 4. Assign global Analyzing slots across competencies (up to globalAnalyzing)
        let analyzingAssigned = 0;
        for (let i = evalAssigned; i < blueprintSlots.length && analyzingAssigned < globalAnalyzing; i++) {
            blueprintSlots[i].plannedBloomLevel = 'Analyzing';
            analyzingAssigned++;
        }

        // 5. Assign remaining slots to LOTS (Remembering, Understanding, Applying)
        const lotsStart = evalAssigned + analyzingAssigned;
        for (let i = lotsStart; i < blueprintSlots.length; i++) {
            const lotsIdx = (i - lotsStart) % 3;
            if (lotsIdx === 0) blueprintSlots[i].plannedBloomLevel = 'Remembering';
            else if (lotsIdx === 1) blueprintSlots[i].plannedBloomLevel = 'Understanding';
            else blueprintSlots[i].plannedBloomLevel = 'Applying';
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
            lockedModel: model || 'gemma-4-31b-it',
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

        if (questions.length !== targetSlots.length) {
            return {
                isValid: false,
                error: `Batch item count mismatch: Expected ${targetSlots.length} items, received ${questions.length}.`
            };
        }

        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const val = AppLogic.validateQuestion(q);
            if (!val.isValid) {
                return { isValid: false, error: `Item ${i+1} validation failed: ${val.error}` };
            }
        }

        return { isValid: true, questions };
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
