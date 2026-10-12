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
    const { apiKey, subject, competency, notes, itemCount, totalExamItems, systemPrompt, selectedModel, useFallback, category } = inputs;

    // Category Distribution Logic
    const dist = category === 'B' ? 
        { lots: '70%', analyzing: '20%', evaluating: '10%' } : 
        { lots: '60%', analyzing: '30%', evaluating: '10%' };

    const prompt = `
        Act as a Professional Assessment Designer and Subject Matter Expert in ${subject}.
        Target Audience: Category ${category} Students (${category === 'B' ? 'Modified for Leniency' : 'Standard'}).
        
        SYSTEM LOGIC & SCHEMA:
        ${JSON.stringify(systemPrompt, null, 2)}

        LEARNING COMPETENCY: "${competency}"
        TOTAL EXAM ITEMS TARGET: ${totalExamItems}
        DISTRIBUTION RULE (TOS): Generate exactly ${itemCount} questions for this competency.

        SPECIFIC AI GUIDANCE/NOTES: "${notes}"

        STRICT ASSESSMENT RULES:
        1. THE "LEARNING WHILE TESTING" PHILOSOPHY: Every question must be educational. Provide a contextual lead-in or stimulus that reminds the student of the lesson or provides relevant information before asking the question. The student should gain insight or reinforcement of the topic just by reading the item.
        
        2. MANDATORY STIMULUS: Every single question (LOTS and HOTS) MUST start with a stimulus (e.g., a scenario, a factual premise, a data point, or a contextual reminder). No naked questions. No labels like "Stimulus:".
        
        3. HIERARCHICAL STEMS: Question stems must strictly follow the Bloom's Taxonomy hierarchy. Use precise verbs corresponding to the identified cognitive level (LOTS: Remembering, Understanding, Applying; HOTS: Analyzing, Evaluating).
        
        4. 21st CENTURY SKILLS INTEGRATION: Every question must apply 21st-century skills (Critical Thinking, Communication, Collaboration, or Creativity). Frame items within real-world problem-solving or professional situational contexts.

        5. DISTRACTOR & OPTION LOGIC (PEDAGOGICAL RIGOR):
           - PLAUSIBILITY: All options must be highly plausible and based on documented common student misconceptions.
           - NO GIVEAWAYS: Ensure no option is obviously wrong or "dead" (homogenous in content and grammar).
           - UNIFORM LENGTH & STRUCTURE: Options must be comparable in word count, grammatical structure, and syntax.
           - EXACTLY ONE CORRECT ANSWER: Ensure exactly one option is unambiguously and defensibly correct.
           - NO TRICK/AMBIGUOUS QUESTIONS: Avoid trick wording, double negatives, and ambiguous phrasing.
           - NO "ALL/NONE OF THE ABOVE": Do NOT use "All of the above", "None of the above", "Both A and B", or similar phrases.
           - ACCURATE INDEX: Set answer_index (0-3) to correspond to the exact position of the correct answer option.

        6. BLOOM'S TAXONOMY RIGOR:
           - Classify cognitive level based on true cognitive process required, not merely superficial action verbs:
             * REMEMBERING: Retrieving or recognizing factual knowledge.
             * UNDERSTANDING: Explaining, interpreting, comparing, or classifying concepts.
             * APPLYING: Using formulas, rules, or procedures in a concrete situation.
             * ANALYZING: Examining evidence, breaking down relationships, or interpreting data.
             * EVALUATING: Defending judgments using criteria/standards.
           - Do not classify recall items as Analyzing merely because "analyze" appears in the stem.
           - COGNITIVE CEILING: Do not exceed the identified ceiling level of the Learning Competency.
        7. SCAFFOLDING & SEQUENTIAL PROGRESSION: Within this competency, generate exactly ${itemCount} items starting from LOTS (Remembering, Understanding, Applying) and progressing to the identified ceiling (Analyzing, Evaluating). Questions MUST be ordered and grouped progressively by cognitive level.
        8. WEIGHTED DISTRIBUTION (CATEGORY ${category}):
           - LOTS (${dist.lots}): Remembering, Understanding, and Applying.
           - ANALYZING (${dist.analyzing}): Analyzing level items.
           - EVALUATING (${dist.evaluating}): Evaluating level items.
           - NO CREATING: Do not generate "Create" level questions.
        9. JSON STRUCTURE: You MUST return a single JSON object with the following structure:
           {
             "identified_competency_level": "The Bloom's level you identified",
             "questions": [ 
                {
                  "question": "...",
                  "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
                  "answer_index": 0, // Integer (0-3) corresponding to the correct option index
                  "cognitive_level": "...",
                  "rationale": "..."
                }
             ]
           }
        
        10. LANGUAGE RULE: Match the language of the Learning Competency/Subject (Use Filipino if applicable).

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
        4. OPTION LENGTH & STRUCTURE: All options must be plausible and relatively equal in length and structure.
        5. LANGUAGE RULE: Maintain the language of the current assessment (Filipino or English) unless the user explicitly requests a translation in their instruction.

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
        4. OPTION LENGTH & STRUCTURE: Ensure options are plausible and relatively equal in length and structure.
        5. LANGUAGE RULE: Maintain the language of the current question item (Filipino or English) unless the user explicitly requests a translation in their instruction.

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
