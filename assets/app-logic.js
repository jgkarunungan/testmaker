/**
 * APP LOGIC ENGINE - Handles TOS Calculations, Exports, and History
 */

const AppLogic = {
    /**
     * Calculates proportional item distribution across competencies using the
     * Largest Remainder Method (Hamilton/Hare-Niemeyer Method).
     * Guarantees that sum(counts) === totalExamItems exactly.
     * @param {Array} targetCompetencies Array of competency objects (with .hours)
     * @param {number} totalExamItems Total requested questions (integer >= 0)
     * @returns {Array<number>} Integer item allocations matching targetCompetencies ordering
     */
    /**
     * Calculates proportional item distribution across competencies using the
     * Largest Remainder Method (Hamilton/Hare-Niemeyer Method).
     * Guarantees that sum(counts) === totalExamItems exactly when totalHours > 0.
     * Rejects allocations where total hours = 0 or hours input is negative/invalid.
     * Exact remainder ties are resolved deterministically using higher teaching hours first, then earlier TOS index.
     * @param {Array} targetCompetencies Array of competency objects (with .hours)
     * @param {number} totalExamItems Total requested questions (integer >= 1)
     * @returns {Object} { isValid: boolean, error?: string, counts?: Array<number>, totalHours?: number }
     */
    calculateTOSDistribution(targetCompetencies, totalExamItems) {
        if (!Array.isArray(targetCompetencies) || targetCompetencies.length === 0) {
            return { isValid: false, error: "No competencies selected for target test.", counts: [] };
        }

        const N = parseInt(totalExamItems, 10);
        if (isNaN(N) || N <= 0) {
            return { isValid: false, error: "Please enter a valid positive number for Total Items.", counts: [] };
        }

        const C = targetCompetencies.length;

        // Validate teaching hours strictly for missing, nonnumeric, or negative inputs
        for (let i = 0; i < C; i++) {
            const comp = targetCompetencies[i];
            const rawHours = comp.hours;
            
            if (rawHours === undefined || rawHours === null || String(rawHours).trim() === '') {
                return { 
                    isValid: false, 
                    error: `Competency "${comp.title || 'Untitled'}" is missing teaching hours. Please enter valid positive numbers.`,
                    counts: [] 
                };
            }

            const parsed = parseFloat(rawHours);
            if (isNaN(parsed) || parsed < 0) {
                return { 
                    isValid: false, 
                    error: `Competency "${comp.title || 'Untitled'}" has invalid or negative teaching hours (${rawHours}). Please enter valid non-negative numbers.`,
                    counts: [] 
                };
            }
        }

        const hoursList = targetCompetencies.map(c => parseFloat(c.hours));
        const totalHours = hoursList.reduce((sum, h) => sum + h, 0);

        // Reject allocation if all eligible teaching hours sum to zero
        if (totalHours === 0) {
            return { 
                isValid: false, 
                error: "Total teaching hours for selected competencies is 0. Please enter valid positive teaching hours before generating.",
                counts: [] 
            };
        }

        // Standard Largest Remainder Method
        const rawAllocations = hoursList.map(h => (h / totalHours) * N);
        const floors = rawAllocations.map(raw => Math.floor(raw));
        const remainders = rawAllocations.map((raw, idx) => raw - floors[idx]);

        let allocatedSum = floors.reduce((s, val) => s + val, 0);
        let unallocated = N - allocatedSum;

        // Rank by remainder descending; deterministic tie-breaking: higher hours, then earlier index
        const rankedIndices = Array.from({ length: C }, (_, i) => i)
            .sort((a, b) => {
                if (Math.abs(remainders[b] - remainders[a]) > 1e-9) {
                    return remainders[b] - remainders[a];
                }
                if (Math.abs(hoursList[b] - hoursList[a]) > 1e-9) {
                    return hoursList[b] - hoursList[a];
                }
                return a - b; // Deterministic TOS list order tie-breaker
            });

        for (let k = 0; k < unallocated; k++) {
            floors[rankedIndices[k]] += 1;
        }

        return { isValid: true, counts: floors, totalHours: totalHours };
    },

    /**
     * Calculates cognitive level item distribution (LOTS, Analyzing, Evaluating)
     * using the Largest Remainder Method based on Category A/B policies.
     * @param {number} itemCount Total question count for competency
     * @param {string} category 'A' (Standard) or 'B' (Leniency)
     * @returns {Object} { lots, analyzing, evaluating } where sum === itemCount
     */
    calculateCognitiveDistribution(itemCount, category) {
        const N = Math.max(0, parseInt(itemCount, 10) || 0);
        if (N === 0) return { lots: 0, analyzing: 0, evaluating: 0 };

        const weights = (category === 'B')
            ? { lots: 0.70, analyzing: 0.20, evaluating: 0.10 }
            : { lots: 0.60, analyzing: 0.30, evaluating: 0.10 };

        const keys = ['lots', 'analyzing', 'evaluating'];
        const raw = keys.map(k => weights[k] * N);
        const floors = raw.map(r => Math.floor(r));
        const remainders = raw.map((r, i) => r - floors[i]);

        let sum = floors.reduce((s, v) => s + v, 0);
        let unallocated = N - sum;

        const ranked = [0, 1, 2].sort((a, b) => {
            if (Math.abs(remainders[b] - remainders[a]) > 1e-9) {
                return remainders[b] - remainders[a];
            }
            return a - b;
        });

        for (let k = 0; k < unallocated; k++) {
            floors[ranked[k]] += 1;
        }

        return { lots: floors[0], analyzing: floors[1], evaluating: floors[2] };
    },

    generateTOSCSV(results, subjectName, category) {
        const totalHours = results.reduce((sum, res) => sum + (parseFloat(res.hours) || 0), 0);
        const status = results[0]?.assessmentStatus || 'Complete';
        const totalRequested = results[0]?.totalRequested;
        const totalActual = results[0]?.totalActual !== undefined 
            ? results[0].totalActual 
            : results.reduce((sum, res) => sum + AppLogic.getQuestions(res).length, 0);

        let csv = `Table of Specifications (TOS) - ${subjectName}\n`;
        csv += `Category: ${category}\n`;
        csv += `Assessment Status: ${status} (Generated: ${totalActual}${totalRequested ? ` / Planned: ${totalRequested}` : ''})\n\n`;
        csv += `Most Essential Learning Competencies,Time Spent (Days),Weight of Time Spent (%),No. of Items Planned,No. of Items Generated,Test Placement,Remembering,Understanding,Applying,Analyzing,Evaluating,Total Generated Items\n`;

        let globalCounter = 1;
        results.forEach(res => {
            const qs = AppLogic.getQuestions(res);
            const hours = parseFloat(res.hours) || 0;
            const weight = totalHours > 0 ? ((hours / totalHours) * 100).toFixed(2) : 0;
            const plannedCount = res.plannedItems !== undefined ? res.plannedItems : qs.length;

            const itemsByLevel = { 'Remembering': [], 'Understanding': [], 'Applying': [], 'Analyzing': [], 'Evaluating': [] };

            const startRange = globalCounter;
            qs.forEach(q => {
                const level = q.cognitive_level || 'Remembering';
                if (itemsByLevel[level]) itemsByLevel[level].push(globalCounter);
                globalCounter++;
            });
            const endRange = globalCounter - 1;
            const placement = qs.length > 0 ? (startRange === endRange ? `${startRange}` : `${startRange}-${endRange}`) : '-';

            csv += `"${res.competency}",`;
            csv += `${hours},`;
            csv += `${weight}%,`;
            csv += `${plannedCount},`;
            csv += `${qs.length},`;
            csv += `"${placement}",`;
            csv += `"${itemsByLevel['Remembering'].join(', ')}",`;
            csv += `"${itemsByLevel['Understanding'].join(', ')}",`;
            csv += `"${itemsByLevel['Applying'].join(', ')}",`;
            csv += `"${itemsByLevel['Analyzing'].join(', ')}",`;
            csv += `"${itemsByLevel['Evaluating'].join(', ')}",`;
            csv += `${qs.length}\n`;
        });

        // Add Total Row
        const totalPlanned = results.reduce((sum, res) => sum + (res.plannedItems !== undefined ? res.plannedItems : AppLogic.getQuestions(res).length), 0);
        csv += `TOTAL,${totalHours},100%,${totalPlanned},${totalActual},,,,,,,${totalActual}\n`;

        return csv;
    },

    getQuestions(res) {
        if (Array.isArray(res.questions)) return res.questions;
        if (typeof res.questions === 'object' && res.questions !== null) {
            if (Array.isArray(res.questions.questions)) return res.questions.questions;
            const arrayKey = Object.keys(res.questions).find(key => Array.isArray(res.questions[key]));
            return arrayKey ? res.questions[arrayKey] : [];
        }
        return [];
    },

    addToHistory(results, category) {
        if (typeof window !== 'undefined' && typeof window.addToHistory === 'function') {
            window.addToHistory(results, category);
            return;
        }
        const currentSubject = AppState.getCurrentSubject();
        const historyItem = {
            id: Date.now(),
            subjectName: currentSubject ? currentSubject.name : 'Unknown',
            timestamp: new Date().toLocaleString(),
            category: category || (results[0]?.category || 'A'),
            data: results
        };
        const hist = AppState.state.history || [];
        hist.unshift(historyItem);
        if (hist.length > 20) hist.pop();
        AppState.save();
    },

    downloadJSON(data, subjectName) {
        if (!data) return;
        const category = data[0]?.category || 'A';
        const storageKey = `vcount_${subjectName}_${category}`;
        let version = parseInt(localStorage.getItem(storageKey) || "1");
        const filename = `assessment-${subjectName.replace(/\s+/g, '-')}-Cat${category}-v${version}.json`;
        localStorage.setItem(storageKey, (version + 1).toString());

        const bundle = {
            exportType: "full_assessment",
            subject: subjectName,
            category: category,
            generatedAt: new Date().toISOString(),
            data: data
        };
        
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    /**
     * Validates a single question item against assessment schema constraints.
     * @param {Object} q Question item object
     * @returns {Object} { isValid: boolean, error?: string }
     */
    /**
     * Validates a single question item against deterministic schema constraints.
     * @param {Object} q Question item object
     * @returns {Object} { isValid: boolean, error?: string }
     */
    validateQuestion(q) {
        if (!q || typeof q !== 'object') {
            return { isValid: false, error: 'Question is not a valid object.' };
        }
        if (typeof q.question !== 'string' || q.question.trim() === '') {
            return { isValid: false, error: 'Question stem is missing or empty.' };
        }
        if (!Array.isArray(q.options) || q.options.length !== 4) {
            return { isValid: false, error: `Expected exactly 4 options, found ${Array.isArray(q.options) ? q.options.length : 0}.` };
        }
        for (let i = 0; i < q.options.length; i++) {
            const opt = q.options[i];
            if (typeof opt !== 'string' || opt.trim() === '') {
                return { isValid: false, error: `Option at index ${i} is empty or not a string.` };
            }
        }
        if (!Number.isInteger(q.answer_index) || q.answer_index < 0 || q.answer_index > 3) {
            return { isValid: false, error: `Invalid answer_index (${q.answer_index}). Expected integer from 0 to 3.` };
        }
        // Case-insensitive duplicate options check
        const normalizedSet = new Set(q.options.map(opt => opt.trim().toLowerCase()));
        if (normalizedSet.size !== 4) {
            return { isValid: false, error: 'Duplicate option choices detected.' };
        }
        // Missing required cognitive level metadata
        if (!q.cognitive_level || typeof q.cognitive_level !== 'string' || q.cognitive_level.trim() === '') {
            return { isValid: false, error: 'Missing required cognitive level metadata.' };
        }

        return { isValid: true };
    },

    /**
     * Checks a question for heuristic quality warnings and academic review notices.
     * Separated from deterministic structural schema validation.
     * @param {Object} q Target question item object
     * @param {Array<Object>} [allQuestions] Optional list of all questions in assessment for cross-checking
     * @returns {Array<string>} List of concise heuristic warning messages
     */
    checkHeuristicQualityWarnings(q, allQuestions = []) {
        const warnings = [];

        if (!q || typeof q !== 'object') return warnings;

        // 1. Option Structure & Weak Distractor Checks
        if (Array.isArray(q.options) && q.options.length === 4) {
            const strippedOpts = q.options.map(o => (typeof o === 'string' ? o.toLowerCase().replace(/[^\w]/g, '') : ''));
            const strippedSet = new Set(strippedOpts);
            if (strippedSet.size < 4) {
                warnings.push("Near-identical answer choices detected.");
            }

            const weakPhraseFound = q.options.some(o => {
                if (typeof o !== 'string') return false;
                const lower = o.toLowerCase();
                return lower.includes('all of the above') || 
                       lower.includes('none of the above') || 
                       lower.includes('both a and b') || 
                       lower.includes('both b and c');
            });
            if (weakPhraseFound) {
                warnings.push("Contains 'All/None of the above' style phrase; review distractor quality.");
            }

            // Option Length Clue Detection
            if (Number.isInteger(q.answer_index) && q.answer_index >= 0 && q.answer_index < 4) {
                const lengths = q.options.map(o => (typeof o === 'string' ? o.trim().length : 0));
                const correctLen = lengths[q.answer_index];
                const otherLens = lengths.filter((_, i) => i !== q.answer_index);
                const avgOther = otherLens.reduce((a, b) => a + b, 0) / 3;

                if (correctLen > 40 && avgOther > 0 && correctLen > avgOther * 2.2) {
                    warnings.push("Correct option is noticeably longer and more detailed than distractors (possible length giveaway clue).");
                }
            }
        }

        // 2. Short question stem check (possible missing stimulus)
        if (typeof q.question === 'string') {
            const stemTrimmed = q.question.trim();
            if (stemTrimmed.length < 25) {
                warnings.push("Short question stem (possible missing contextual stimulus).");
            }

            // Answer Leakage Detection (Check if stem directly states the correct option text verbatim)
            if (Array.isArray(q.options) && Number.isInteger(q.answer_index) && q.answer_index >= 0 && q.answer_index < 4) {
                const correctText = (q.options[q.answer_index] || '').trim();
                if (correctText.length > 15 && stemTrimmed.toLowerCase().includes(correctText.toLowerCase())) {
                    warnings.push("Possible answer leakage: Question stem appears to directly contain the correct answer text.");
                }
            }

            // Bloom's Taxonomy Mismatch Check
            const cogLevel = (q.cognitive_level || '').trim();
            if (cogLevel === 'Analyzing' || cogLevel === 'Evaluating') {
                const lower = stemTrimmed.toLowerCase();
                const isSimpleRecall = /^(ano ang|sino ang|kailan|tukuyin|identify|what is|who was|when did|define)\b/i.test(lower);
                const hasContextualKeyword = /sitwasyon|halimbawa|scenario|suriin|paano|bakit|compare|analyze|evaluate|dataset|evidence/i.test(lower);

                if (isSimpleRecall && !hasContextualKeyword) {
                    warnings.push("Possible Bloom's Taxonomy mismatch: Labeled as HOTS (" + cogLevel + "), but question stem resembles factual recall.");
                }
            }
        }

        // 3. Duplicate question stem check across the assessment
        if (typeof q.question === 'string' && Array.isArray(allQuestions) && allQuestions.length > 1) {
            const currentNormStem = q.question.trim().toLowerCase().replace(/[^\w]/g, '');
            const matchCount = allQuestions.filter(otherQ => {
                if (!otherQ || typeof otherQ.question !== 'string') return false;
                const otherNormStem = otherQ.question.trim().toLowerCase().replace(/[^\w]/g, '');
                return currentNormStem === otherNormStem;
            }).length;

            if (matchCount > 1) {
                warnings.push("Duplicate or near-identical question stem detected across assessment.");
            }
        }

        return warnings;
    },

    /**
     * Balances answer positions (A, B, C, D) as evenly as mathematically possible
     * across all valid questions in an assessment using an unbiased Fisher-Yates shuffle.
     * @param {Array} results Array of competency result objects
     * @returns {Array} The updated results object with balanced options
     */
    balanceAssessmentAnswers(results) {
        if (!Array.isArray(results)) return results;

        // 1. Collect all valid question object references
        const validQuestionList = [];
        results.forEach(res => {
            const qs = AppLogic.getQuestions(res);
            qs.forEach(q => {
                const val = AppLogic.validateQuestion(q);
                if (val.isValid) {
                    delete q._validationError;
                    validQuestionList.push(q);
                } else {
                    q._validationError = val.error;
                }
            });
        });

        const N = validQuestionList.length;
        if (N === 0) return results;

        // 2. Build mathematically balanced target answer indices (0, 1, 2, 3)
        const baseCount = Math.floor(N / 4);
        const remainder = N % 4;

        // Determine which remainder letters get +1 extra item using a randomized order
        const remainderIndices = [0, 1, 2, 3];
        AppLogic.fisherYatesShuffle(remainderIndices);

        const targetCounts = [baseCount, baseCount, baseCount, baseCount];
        for (let r = 0; r < remainder; r++) {
            targetCounts[remainderIndices[r]] += 1;
        }

        // Build targetPool containing targetCounts[0] 0s, targetCounts[1] 1s, etc.
        const targetPool = [];
        for (let letterIdx = 0; letterIdx < 4; letterIdx++) {
            for (let c = 0; c < targetCounts[letterIdx]; c++) {
                targetPool.push(letterIdx);
            }
        }

        // Randomize the sequence of target positions across the assessment questions
        AppLogic.fisherYatesShuffle(targetPool);

        // 3. Rearrange options for each valid question using original index tracking
        validQuestionList.forEach((q, k) => {
            const targetIndex = targetPool[k];
            const origAnswerIdx = q.answer_index;
            const originalCorrectOption = q.options[origAnswerIdx];

            // Extract distractors by original array position to prevent string duplicate issues
            const distractors = q.options.filter((_, idx) => idx !== origAnswerIdx);

            // Shuffle the 3 distractors
            AppLogic.fisherYatesShuffle(distractors);

            // Reconstruct options array placing correct answer at targetIndex
            const newOptions = [...distractors];
            newOptions.splice(targetIndex, 0, originalCorrectOption);

            q.options = newOptions;
            q.answer_index = targetIndex;
        });

        return results;
    },

    /**
     * Balances a single regenerated or refined question item.
     * Preserves the existing correct answer index if valid, or assigns a random position.
     * @param {Object} q Question object
     * @param {number} [preferredIndex] Preferred target index (0-3)
     * @returns {Object} Updated question object
     */
    balanceSingleItem(q, preferredIndex) {
        const val = AppLogic.validateQuestion(q);
        if (!val.isValid) {
            q._validationError = val.error;
            return q;
        }
        delete q._validationError;

        let targetIndex = (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex <= 3) 
            ? preferredIndex 
            : Math.floor(Math.random() * 4);

        const origAnswerIdx = q.answer_index;
        const originalCorrectOption = q.options[origAnswerIdx];

        const distractors = q.options.filter((_, idx) => idx !== origAnswerIdx);
        AppLogic.fisherYatesShuffle(distractors);

        const newOptions = [...distractors];
        newOptions.splice(targetIndex, 0, originalCorrectOption);

        q.options = newOptions;
        q.answer_index = targetIndex;

        return q;
    },

    /**
     * In-place Fisher-Yates shuffle helper.
     * @param {Array} array
     * @returns {Array}
     */
    fisherYatesShuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
};
