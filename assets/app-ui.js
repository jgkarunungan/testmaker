/**
 * APP UI ENGINE - Handles all DOM rendering and modal displays
 */

const AppUI = {
    renderQuestionnaire(container, results, examTitle) {
        container.innerHTML = '';
        const titleElem = document.createElement('h3');
        titleElem.className = 'text-xl font-bold text-indigo-400 mb-6 border-b border-slate-800 pb-2';
        titleElem.innerText = examTitle;
        container.appendChild(titleElem);

        let globalCounter = 1;
        results.forEach((res, resIdx) => {
            const section = document.createElement('div');
            let competencyLevel = res.identified_competency_level || 'Not Identified';

            section.innerHTML = `
                <div class="flex justify-between items-end mb-2 mt-8 first:mt-0">
                    <h4 class="text-indigo-400 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
                        <span class="w-8 h-[1px] bg-indigo-500/30"></span>
                        ${res.competency}
                    </h4>
                    <div class="text-[10px] bg-slate-800 text-slate-400 px-3 py-1 rounded-full border border-slate-700">
                        Ceiling: <span class="text-white font-bold">${competencyLevel}</span>
                    </div>
                </div>
            `;

            const questions = AppLogic.getQuestions(res);
            questions.forEach((q, qIdx) => {
                const card = document.createElement('div');
                card.className = 'bg-slate-900/40 border border-slate-800 p-6 rounded-2xl mb-4 relative group';
                card.innerHTML = `
                    <div class="flex justify-between items-start mb-4">
                        <p class="text-white font-medium flex-1"><span class="text-slate-500 mr-2">Q${globalCounter++}.</span> ${q.question}</p>
                        <span class="px-2 py-1 rounded bg-indigo-500/10 text-indigo-400 text-[9px] font-bold uppercase border border-indigo-500/20">${q.cognitive_level || ''}</span>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                        ${(q.options || []).map((opt, i) => `
                            <div class="p-3 rounded-xl border ${i === q.answer_index ? 'border-green-500/50 bg-green-500/5 text-green-400' : 'border-slate-800 bg-slate-950/50 text-slate-400'} text-sm">
                                <span class="font-bold mr-2">${String.fromCharCode(65 + i)}.</span> ${opt}
                            </div>
                        `).join('')}
                    </div>
                    <div class="bg-blue-500/5 border border-blue-500/10 p-4 rounded-xl mb-4 text-xs italic text-slate-400">
                        <b>Rationale:</b> ${q.rationale || 'None.'}
                    </div>
                    <div class="flex gap-2 items-center pt-4 border-t border-slate-800/50">
                        <input type="text" placeholder="Refine just this question..." class="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none">
                        <button onclick="handleRefineIndividualItem(this, ${resIdx}, ${qIdx})" class="px-3 py-1.5 bg-slate-800 hover:bg-blue-600 text-white text-[10px] font-bold rounded-lg transition-all">Update Item</button>
                    </div>
                `;
                section.appendChild(card);
            });
            container.appendChild(section);
        });
    },

    renderSubjects(nav, subjects, currentId, onSelect, onDelete) {
        nav.innerHTML = '';
        subjects.forEach(sub => {
            const isActive = sub.id === currentId;
            const btn = document.createElement('button');
            btn.className = `w-full text-left px-4 py-2 rounded-lg transition-all flex items-center justify-between group ${isActive ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 font-medium' : 'text-slate-400 hover:bg-slate-800'}`;
            btn.onclick = () => onSelect(sub.id);
            btn.innerHTML = `
                <span><i class="fas fa-book-open mr-2"></i> ${sub.name}</span>
                <i onclick="event.stopPropagation(); ${onDelete}('${sub.id}')" class="fas fa-times opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity p-1"></i>
            `;
            nav.appendChild(btn);
        });
    },

    renderCompetencies(container, subject) {
        container.innerHTML = '';
        if (!subject) {
            document.getElementById('current-subject').innerText = 'No Subject Selected';
            return;
        }

        document.getElementById('current-subject').innerText = subject.name;

        subject.competencies.forEach(comp => {
            const div = document.createElement('div');
            div.className = 'glass p-6 rounded-2xl border-l-4 border-blue-500 shadow-xl relative group mb-6';
            div.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <div class="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div class="md:col-span-3">
                            <label class="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Competency Title</label>
                            <input type="text" value="${comp.title}" onchange="AppState.updateCompetency('${comp.id}', 'title', this.value)"
                                   class="bg-transparent text-xl font-bold outline-none w-full border-b border-transparent focus:border-blue-500/50 pb-1">
                        </div>
                        <div>
                            <label class="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Time Spent (Days)</label>
                            <input type="number" value="${comp.hours || 1}" onchange="AppState.updateCompetency('${comp.id}', 'hours', this.value)"
                                   class="bg-slate-950/50 border border-slate-800 rounded-lg py-1 px-3 w-full text-blue-400 outline-none focus:ring-1 ring-blue-500/30">
                        </div>
                    </div>
                    <button onclick="handleDeleteCompetency('${comp.id}')" class="p-2 text-slate-600 hover:text-red-400 transition-colors">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
                <div>
                    <label class="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2 block">AI Guidance & Notes</label>
                    <textarea onchange="AppState.updateCompetency('${comp.id}', 'notes', this.value)"
                              placeholder="Describe how AI should generate questions for this..."
                              class="w-full bg-slate-950/50 border border-slate-800 rounded-xl p-4 text-sm text-slate-300 outline-none h-32 focus:ring-2 ring-blue-500/20 transition-all">${comp.notes}</textarea>
                </div>
            `;
            container.appendChild(div);
        });
    },

    renderHistory(container, history, onSelect, onDelete) {
        container.innerHTML = '';
        history.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'w-full flex items-center gap-2 group mb-2';
            
            const btn = document.createElement('button');
            btn.className = 'flex-1 text-left p-3 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-blue-500/50 transition-all';
            btn.onclick = () => onSelect(item.data);
            btn.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-xs font-bold text-slate-300 truncate w-24">${item.subjectName}</span>
                    <span class="text-[9px] text-slate-600">${item.timestamp.split(',')[0]}</span>
                </div>
                <p class="text-[10px] text-slate-500 mt-1">${item.data.length} Comps | Cat ${item.category || 'A'}</p>
            `;
            
            const delBtn = document.createElement('button');
            delBtn.className = 'p-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity';
            delBtn.onclick = (e) => { e.stopPropagation(); onDelete(index); };
            delBtn.innerHTML = '<i class="fas fa-trash-alt text-xs"></i>';
            
            div.appendChild(btn);
            div.appendChild(delBtn);
            container.appendChild(div);
        });
    }
};
