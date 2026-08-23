/**
 * APP LOGIC ENGINE - Handles TOS Calculations, Exports, and History
 */

const AppLogic = {
    calculateTOSDistribution(targetCompetencies, totalExamItems) {
        const totalHours = targetCompetencies.reduce((sum, c) => sum + (parseFloat(c.hours) || 1), 0);
        let remainingItems = totalExamItems;

        return targetCompetencies.map((comp, idx) => {
            if (idx === targetCompetencies.length - 1) {
                return remainingItems; // Last one balances the total
            }
            let count = Math.round(((parseFloat(comp.hours) || 1) / totalHours) * totalExamItems);
            if (count === 0 && remainingItems > 0) count = 1;
            if (count > remainingItems) count = remainingItems;
            remainingItems -= count;
            return count;
        });
    },

    generateTOSCSV(results, subjectName, category) {
        const totalHours = results.reduce((sum, res) => sum + (parseFloat(res.hours) || 0), 0);

        let csv = `Table of Specifications (TOS) - ${subjectName}\n`;
        csv += `Category: ${category}\n\n`;
        csv += `Most Essential Learning Competencies,Time Spent (Days),Weight of Time Spent (%),No. of Items per Competency,Test Placement,Remembering,Understanding,Applying,Analyzing,Evaluating,Total Items\n`;

        let globalCounter = 1;
        results.forEach(res => {
            const qs = AppLogic.getQuestions(res);
            const hours = parseFloat(res.hours) || 0;
            const weight = totalHours > 0 ? ((hours / totalHours) * 100).toFixed(2) : 0;

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
        const totalItems = results.reduce((sum, res) => sum + AppLogic.getQuestions(res).length, 0);
        csv += `TOTAL,${totalHours},100%,${totalItems},,,,,,,${totalItems}\n`;

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
        const currentSubject = AppState.getCurrentSubject();
        const historyItem = {
            id: Date.now(),
            subjectName: currentSubject ? currentSubject.name : 'Unknown',
            timestamp: new Date().toLocaleString(),
            category: category || (results[0]?.category || 'A'),
            data: results
        };
        AppState.state.history.unshift(historyItem);
        if (AppState.state.history.length > 20) AppState.state.history.pop();
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
    }
};
