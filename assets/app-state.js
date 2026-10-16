/**
 * APP STATE ENGINE - Handles persistence and global data management
 * Proxy object ensuring AppState operates directly on window.state and window.saveToLocalStorage
 */

const AppState = {
    get state() {
        if (typeof window !== 'undefined' && window.state) {
            return window.state;
        }
        return this._fallbackState;
    },

    _fallbackState: {
        schoolYears: [{ id: 'sy-2026-2027', name: 'SY 2026-2027' }],
        currentSchoolYearId: 'sy-2026-2027',
        currentSubjectId: '1',
        currentTerm: 'T1',
        subjects: [
            {
                id: '1',
                name: 'Mathematics',
                schoolYearId: 'sy-2026-2027',
                competencies: [
                    { id: 'c1', title: 'Quadratic Equations', notes: 'Focus on real-world applications of the quadratic formula.', hours: 1, term: 'T1', schoolYearId: 'sy-2026-2027', targetS1: true, targetS2: false, targetTerm: true }
                ]
            }
        ],
        apiKey: localStorage.getItem('gemini_api_key') || '',
        selectedModel: localStorage.getItem('testmaker_model') || 'gemini-3.5-flash-lite',
        thinkingLevel: localStorage.getItem('testmaker_thinking_level') || 'high',
        useFallback: localStorage.getItem('testmaker_use_fallback') !== 'false',
        history: JSON.parse(localStorage.getItem('testmaker_history') || '[]'),
        systemPrompt: localStorage.getItem('system_prompt') || ''
    },

    init() {
        if (typeof window !== 'undefined' && typeof window.loadAndMigrateState === 'function') {
            window.loadAndMigrateState();
        }
    },

    save() {
        if (typeof window !== 'undefined' && typeof window.saveToLocalStorage === 'function') {
            return window.saveToLocalStorage();
        }
        return false;
    },

    getCurrentSubject() {
        const s = this.state;
        if (!s || !Array.isArray(s.subjects)) return null;
        return s.subjects.find(sub => sub.id === s.currentSubjectId && sub.schoolYearId === s.currentSchoolYearId)
            || s.subjects.find(sub => sub.id === s.currentSubjectId)
            || s.subjects[0] || null;
    },

    updateCompetency(compId, field, value) {
        if (typeof window !== 'undefined' && typeof window.updateCompetency === 'function') {
            window.updateCompetency(compId, field, value);
        } else {
            const subject = this.getCurrentSubject();
            if (subject && Array.isArray(subject.competencies)) {
                const comp = subject.competencies.find(c => c.id === compId);
                if (comp) {
                    comp[field] = value;
                    this.save();
                }
            }
        }
    }
};
