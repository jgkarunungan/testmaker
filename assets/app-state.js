/**
 * APP STATE ENGINE - Handles persistence and global data management
 */

const AppState = {
    state: {
        subjects: [
            { id: '1', name: 'Mathematics', competencies: [
                { id: 'c1', title: 'Quadratic Equations', notes: 'Focus on real-world applications of the quadratic formula. Include at least one question involving area of rectangles and one involving vertical motion. Ensure difficulty is set to Grade 10 level.' }
            ]}
        ],
        currentSubjectId: localStorage.getItem('testmaker_current_subject') || '1',
        apiKey: localStorage.getItem('gemini_api_key') || '',
        selectedModel: localStorage.getItem('testmaker_model') || 'gemini-1.5-flash',
        useFallback: localStorage.getItem('testmaker_use_fallback') !== 'false',
        history: JSON.parse(localStorage.getItem('testmaker_history') || '[]'),
        systemPrompt: localStorage.getItem('system_prompt') || `{
  "role": "Expert Pedagogical Assessment Generator",
  "format": "Multiple Choice Questions",
  "config": {
    "options_per_question": 4,
    "language": "Match Subject/Competency",
    "output_schema": {
      "question": "string",
      "options": ["string"],
      "answer_index": "number",
      "cognitive_level": "string",
      "rationale": "string"
    }
  },
  "constraints": [
    "Avoid trick questions unless specified",
    "Ensure all distractors are plausible",
    "Keep language inclusive and professional"
  ]
}`
    },

    init() {
        const savedState = localStorage.getItem('testmaker_state');
        if (savedState) {
            this.state.subjects = JSON.parse(savedState);
            if (!this.state.subjects.find(s => s.id === this.state.currentSubjectId) && this.state.subjects.length > 0) {
                this.state.currentSubjectId = this.state.subjects[0].id;
            }
        }
    },

    save() {
        localStorage.setItem('testmaker_state', JSON.stringify(this.state.subjects));
        localStorage.setItem('testmaker_current_subject', this.state.currentSubjectId);
        localStorage.setItem('testmaker_model', this.state.selectedModel);
        localStorage.setItem('testmaker_use_fallback', this.state.useFallback);
        localStorage.setItem('testmaker_history', JSON.stringify(this.state.history));
        localStorage.setItem('gemini_api_key', this.state.apiKey);
        localStorage.setItem('system_prompt', this.state.systemPrompt);
    },

    getCurrentSubject() {
        return this.state.subjects.find(s => s.id === this.state.currentSubjectId);
    },

    updateCompetency(compId, field, value) {
        const subject = this.getCurrentSubject();
        const comp = subject.competencies.find(c => c.id === compId);
        if (comp) {
            comp[field] = value;
            this.save();
        }
    }
};
