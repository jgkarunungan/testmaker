/**
 * AI CORE LOGIC - Isolated to prevent accidental changes to prompts or models.
 */

const AI_CONFIG = {
    PRO_MODEL: { name: 'gemini-1.5-pro', version: 'v1beta' },
    LITE_MODEL: { name: 'gemini-3.1-flash-lite', version: 'v1beta' },
    FLASH_MODEL: { name: 'gemini-1.5-flash', version: 'v1' }
};

/**
 * Generates a full DLP based on user inputs
 */
async function callGenerateDLP(inputs) {
    // ... (rest of the function remains the same, I'll just add the new function after it)
}

/**
 * Generates Multiple Choice Questions based on competency and notes
 */
async function callGenerateMCQ(inputs) {
    const { apiKey, subject, competency, notes, hours, totalExamItems, totalHours, systemPrompt, selectedModel, useFallback, category } = inputs;

    // Calculate number of items for this competency based on TOS logic
    let itemCount = Math.round((hours / totalHours) * totalExamItems);
    if (itemCount === 0 && totalExamItems > 0 && hours > 0) itemCount = 1;

    // Category Distribution Logic
    const dist = category === 'B' ? 
        { easy: '70%', average: '20%', difficult: '10%' } : 
        { easy: '50%', average: '30%', difficult: '20%' };

    const prompt = `
        Act as a Professional Assessment Designer and Subject Matter Expert in ${subject}.
        Target Audience: Category ${category} Students (${category === 'B' ? 'Modified for Leniency' : 'Standard'}).
        
        SYSTEM LOGIC & SCHEMA:
        ${JSON.stringify(systemPrompt, null, 2)}

        LEARNING COMPETENCY: "${competency}"
        HOURS SPENT: ${hours} hours
        TOTAL EXAM ITEMS TARGET: ${totalExamItems}
        DISTRIBUTION RULE (TOS): Based on ${hours}/${totalHours} hours, generate exactly ${itemCount} questions for this competency.

        SPECIFIC AI GUIDANCE/NOTES: "${notes}"

        STRICT ASSESSMENT RULES (REVISED BLOOM'S TAXONOMY):
        1. COGNITIVE CEILING: Identify the cognitive level of the Learning Competency. Do NOT create questions that exceed this level.
        2. SCAFFOLDING: You are expected to create questions at the identified level AND levels below it to ensure a comprehensive measure of the competency.
        3. WEIGHTED DISTRIBUTION (CATEGORY ${category}):
           - EASY (${dist.easy}): Knowledge/Remembering and Understanding.
           - AVERAGE (${dist.average}): Applying and Analyzing.
           - DIFFICULT (${dist.difficult}): Evaluating.
           - NO CREATING: Do not generate "Create" level questions.
        4. CEILING ADAPTATION: If the Competency's cognitive level is lower than a distribution tier, reallocate the percentages for higher tiers to the highest available level for this competency.
        
        5. QUESTION STEMS: Use professional stems strictly aligned with the specific Bloom's level assigned to each question.
        6. COGNITIVE LEVEL TAGGING: For every question generated, you MUST include a "cognitive_level" field in the JSON identifying which level was used.
        7. COMPETENCY IDENTIFICATION: You MUST also include a top-level field "identified_competency_level" in your JSON response stating the overall cognitive level you identified for the Learning Competency.
        8. SEQUENTIAL PROGRESSION: Within this competency, questions MUST be ordered and grouped progressively by cognitive level: Remembering -> Understanding -> Applying -> Analyzing -> Evaluating.
        9. DISTRACTOR LOGIC: Ensure all distractors are plausible, homogenous, and based on common misconceptions.
        10. LANGUAGE RULE: Match the language of the Learning Competency and Subject. If the Subject is "Araling Panlipunan" or the text of the Competency is in Filipino, the generated questions and options MUST be in Filipino. Otherwise, use the language specified in the SYSTEM LOGIC.

        IMPORTANT: RETURN A JSON OBJECT OR ARRAY ONLY. NO MARKDOWN WRAPPERS. JUST THE RAW JSON TEXT matching the requested schema.`;

    const selectedModelObj = selectedModel === 'gemini-1.5-pro' ? AI_CONFIG.PRO_MODEL : 
                           selectedModel === 'gemini-3.1-flash-lite' ? AI_CONFIG.LITE_MODEL :
                           AI_CONFIG.FLASH_MODEL;

    let modelsToTry = [selectedModelObj];
    if (useFallback) {
        // Build a unique list of fallbacks
        const fallbacks = [AI_CONFIG.LITE_MODEL, AI_CONFIG.FLASH_MODEL, AI_CONFIG.PRO_MODEL];
        modelsToTry = [...new Set([selectedModelObj, ...fallbacks])];
    }

    return await executeAiRequest(apiKey, prompt, modelsToTry);
}

/**
 * Refines a specific segment of the DLP
 */
async function callRefineSegment(inputs) {
    const { apiKey, subject, promptText, context, selectedModel } = inputs;

    const refinePrompt = `
        Act as a DepEd Master Teacher crafting a student-centered instructional guide.
        I have this specific segment from a lesson plan in ${subject}:
        "${context}"

        User Request: "${promptText}"

        TONE RULE: Avoid administrative jargon. Speak as if you are directly guiding the teacher on how to talk to and engage the students. The language should be professional, immersive, and sophisticated.
        FORMATTING RULE: If there are multiple segments or steps, separate them with <br><br> to ensure they don't pile up in a single paragraph. Use <b> tags for headers.
        LANGUAGE RULE: Maintain the same language (Filipino or English) as the current segment text provided above.

        Please rewrite this segment to fulfill the request. RETURN ONLY THE UPDATED TEXT.
        USE HTML TAGS (<ul>, <li>, <b>, <p>, <br>) IF NECESSARY.
        NO MARKDOWN. NO JSON. JUST THE UPDATED CONTENT.`;

    const model = selectedModel === 'gemini-1.5-pro' ? AI_CONFIG.PRO_MODEL : AI_CONFIG.LITE_MODEL;

    const result = await executeAiRequest(apiKey, refinePrompt, [model]);
    return result.text ? result.text.replace(/^```html\n?|```$/gm, '').trim() : null;
}

/**
 * Refines the entire assessment based on follow-up instructions
 */
async function callRefineAssessment(inputs) {
    const { apiKey, subject, currentAssessment, instruction, selectedModel } = inputs;

    const prompt = `
        Act as a Professional Assessment Designer.
        I have this current MCQ assessment for the subject "${subject}":
        ${JSON.stringify(currentAssessment, null, 2)}

        USER FOLLOW-UP INSTRUCTION: "${instruction}"

        INSTRUCTIONS:
        1. Rewrite or modify the assessment based on the user's instruction.
        2. Maintain the same JSON schema.
        3. Ensure the quality, Bloom's Taxonomy alignment, and sequential ordering rules are still followed.
        4. LANGUAGE RULE: Maintain the language of the current assessment (Filipino or English) unless the user explicitly requests a translation in their instruction.

        RETURN ONLY THE UPDATED JSON. NO MARKDOWN.`;

    const model = selectedModel === 'gemini-1.5-pro' ? AI_CONFIG.PRO_MODEL : AI_CONFIG.LITE_MODEL;

    const result = await executeAiRequest(apiKey, prompt, [model]);
    if (result.success) {
        let cleanJson = result.text.trim();
        const start = cleanJson.indexOf('[');
        const end = cleanJson.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
            return { text: cleanJson.substring(start, end + 1), success: true };
        }
        const startObj = cleanJson.indexOf('{');
        const endObj = cleanJson.lastIndexOf('}');
        if (startObj !== -1 && endObj !== -1) {
            return { text: cleanJson.substring(startObj, endObj + 1), success: true };
        }
    }
    return result;
}

/**
 * Refines a single question item based on follow-up instructions
 */
async function callRefineItem(inputs) {
    const { apiKey, subject, questionItem, instruction, selectedModel } = inputs;

    const prompt = `
        Act as a Professional Assessment Designer.
        I have this specific multiple-choice question for the subject "${subject}":
        ${JSON.stringify(questionItem, null, 2)}

        USER INSTRUCTION FOR THIS ITEM: "${instruction}"

        INSTRUCTIONS:
        1. Modify this specific question based on the user's instruction.
        2. Return the updated question in the same JSON format.
        3. Maintain Bloom's Taxonomy alignment and distractor quality.
        4. LANGUAGE RULE: Maintain the language of the current question item (Filipino or English) unless the user explicitly requests a translation in their instruction.

        RETURN ONLY THE UPDATED JSON OBJECT. NO MARKDOWN.`;

    const model = selectedModel === 'gemini-1.5-pro' ? AI_CONFIG.PRO_MODEL : AI_CONFIG.LITE_MODEL;

    const result = await executeAiRequest(apiKey, prompt, [model]);
    if (result.success) {
        let cleanJson = result.text.trim();
        const start = cleanJson.indexOf('{');
        const end = cleanJson.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            const jsonText = cleanJson.substring(start, end + 1);
            try {
                JSON.parse(jsonText); // Validate JSON
                return { text: jsonText, success: true };
            } catch (e) {
                return { success: false, text: "AI returned invalid JSON: " + jsonText };
            }
        }
        return { success: false, text: "AI response did not contain a JSON object." };
    }
    return result;
}

/**
 * Internal helper to handle the Fetch API and retries
 */
async function executeAiRequest(apiKey, prompt, models) {
    let lastError = '';
    for (const model of models) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/${model.version}/models/${model.name}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const data = await response.json();
            if (response.ok) {
                if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                    lastError = "AI safety filter triggered or empty response.";
                    continue;
                }
                let text = data.candidates[0].content.parts[0].text;
                // Clean markdown wrappers if present
                text = text.replace(/^```[a-z]*\n?|```$/gm, '').trim();
                return { text, success: true };
            } else {
                lastError = data.error ? data.error.message : 'Unknown Error';
            }
        } catch (error) {
            lastError = error.message;
        }
    }
    throw new Error(lastError);
}
