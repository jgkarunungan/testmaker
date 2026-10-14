/**
 * AI CORE LOGIC - Isolated to prevent accidental changes to prompts or models.
 */

const AI_CONFIG = {
    PRIMARY_MODEL: { name: 'gemini-3.8-flash', version: 'v1beta', supportsThinking: true },
    ECONOMY_MODEL: { name: 'gemini-3.1-flash-lite', version: 'v1beta', supportsThinking: true }
};

function getModelConfig(selectedModel) {
    if (selectedModel === 'gemini-3.1-flash-lite') {
        return AI_CONFIG.ECONOMY_MODEL;
    }
    return AI_CONFIG.PRIMARY_MODEL;
}

function getModelsToTry(selectedModel, useFallback) {
    const mainModel = getModelConfig(selectedModel);
    if (!useFallback) {
        return [mainModel];
    }
    const fallbackModel = mainModel.name === AI_CONFIG.PRIMARY_MODEL.name
        ? AI_CONFIG.ECONOMY_MODEL
        : AI_CONFIG.PRIMARY_MODEL;
    return [mainModel, fallbackModel];
}

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
    const { apiKey, subject, competency, notes, itemCount, totalExamItems, systemPrompt, selectedModel, thinkingLevel, useFallback, category } = inputs;

    // Category Distribution Target Policy
    const dist = category === 'B' ? 
        { lots: '70%', analyzing: '20%', evaluating: '10%' } : 
        { lots: '60%', analyzing: '30%', evaluating: '10%' };

    const formattedNotes = (notes && typeof notes === 'string' && notes.trim().length > 0)
        ? notes.trim()
        : "[NO SPECIFIC TEACHER NOTES PROVIDED - Assess the learning competency broadly within standard grade-level curriculum boundaries.]";

    const prompt = `
Act as a Master Assessment Designer and Subject Matter Specialist in ${subject}.
Target Audience: Category ${category} Students (${category === 'B' ? 'Modified for Leniency/Scaffolding' : 'Standard'}).

SYSTEM CONFIGURATION:
${JSON.stringify(systemPrompt, null, 2)}

1. AUTHORITATIVE TARGET & INSTRUCTIONAL BOUNDARIES:
   - SUBJECT: "${subject}"
   - LEARNING COMPETENCY: "${competency}"
   - TEACHER'S AI GUIDANCE & NOTES (AUTHORITATIVE INSTRUCTIONAL SCOPE):
     <ai_guidance_and_notes>
     ${formattedNotes}
     </ai_guidance_and_notes>

   CRITICAL INSTRUCTIONAL SCOPE RULE:
   - The Learning Competency defines WHAT students should learn.
   - The Teacher's AI Guidance & Notes define WHICH SPECIFIC TOPICS, CONCEPTS, EXPLANATIONS, AND EXAMPLES were actually taught and must be assessed.
   - Restrict question content, terms, and context strictly to the material covered in the notes and competency.
   - DO NOT introduce untaught theories, obscure names, or unrelated textbook concepts simply to make questions harder.
   - Higher cognitive difficulty (HOTS) MUST come from MORE DEMANDING THINKING about taught concepts (e.g. comparing post evidence, evaluating competing claims using taught criteria), NEVER from introducing new untaught subject knowledge.

2. MANDATORY INSTRUCTIONAL LANGUAGE SELECTION & CONSISTENCY RULES:
   Determine the target output language using this strict priority hierarchy:
   - PRIORITY 1 (EXPLICIT TEACHER DIRECTIVE): If the teacher's notes explicitly specify an output language (e.g. "Generate in Filipino", "Use English for test", "Gamitin ang wikang Filipino"), follow that directive 100%.
   - PRIORITY 2 (INSTRUCTIONAL AGREEMENT): When competency and notes use the same primary language (Filipino or English), generate the entire examination in that language.
   - PRIORITY 3 (MIXED-LANGUAGE INPUTS): When notes are written in another language as an explanatory summary (e.g. English notes summarizing a Filipino Social Studies competency), generate the examination in the PRIMARY LANGUAGE OF THE LEARNING COMPETENCY (e.g. Filipino). Do NOT switch the entire exam output language merely because notes used English explanations or keywords.
   - PRIORITY 4 (MISSING NOTES FALLBACK): If notes are empty, follow the primary language of the Learning Competency.
   - LANGUAGE SCOPE: Apply the chosen target language across ALL fields: (1) stimulus, (2) question stem, (3) Option A, (4) Option B, (5) Option C, (6) Option D, (7) rationale, and (8) competency metadata.
   - TECHNICAL EXCEPTIONS: Preserve legitimate technical terms (e.g. "quadratic formula"), proper nouns ("Jose Rizal", "Acapulco"), historical titles ("Polo y Servicios", "Katipunan"), philosophical terms ("intersubjectivity"), and mathematical notation. Avoid random Taglish or code-switching.

3. EXAMINATION TARGET & ITEM ALLOCATION:
   - TOTAL EXAM TARGET: ${totalExamItems}
   - TOS ITEM ALLOCATION: Generate exactly ${itemCount} items for this competency.
   - TARGET WEIGHTING (CATEGORY ${category}): Target LOTS (${dist.lots}), Analyzing (${dist.analyzing}), Evaluating (${dist.evaluating}).
   - NO CREATING LEVEL: Do not generate "Create" level items for multiple-choice questions.

4. "LEARNING WHILE TESTING" STIMULUS DESIGN BY BLOOM'S TAXONOMY LEVEL:
   - Every question MUST begin with an educational lead-in stimulus. No naked questions. No labels like "Stimulus:".
   - The stimulus MUST reinforce taught concepts without giving away, paraphrasing, or stating the correct answer text.
   - Stimulus construction rules:
     * REMEMBERING: Brief factual/situational introduction setting up the taught topic without revealing the target fact.
     * UNDERSTANDING: Conceptual explanation or example requiring interpretation of taught material.
     * APPLYING: A concrete, realistic scenario requiring application of taught rules or procedures.
     * ANALYZING: Contrasting post evidence, arguments, assumptions, or data points requiring students to examine relationships.
     * EVALUATING: Decision-making situations or competing claims requiring judgment against taught criteria.

5. REVISED BLOOM'S TAXONOMY RIGOR (ANDERSON & KRATHWOHL):
   - CLASSIFICATION RULE: Classify cognitive level solely by the mental operation required to identify the correct answer—NEVER merely by the action verb used in the stem.
   - HOTS REQUIREMENTS:
     * ANALYZING: Must require identifying assumptions, comparing causes/consequences, analyzing evidence, or detecting inconsistencies.
     * EVALUATING: Must require critiquing arguments against logical criteria or justifying a choice under stated conditions.
   - COMPETENCY COGNITIVE CEILING: If the competency ceiling is LOTS, generate high-quality LOTS items within that ceiling without falsely labeling them as HOTS.

6. STEM, CORRECT ANSWER, & DISTRACTOR CONSTRUCTION:
   - EXACTLY 4 OPTIONS: Every item must have 4 choices (indices 0 to 3).
   - ONE DEFENDED CORRECT ANSWER: Unambiguously correct and academically defensible within taught coverage.
   - THREE CREDIBLE DISTRACTORS: Must represent realistic student misconceptions or common reasoning errors on taught material.
   - PARALLEL STRUCTURE & EQUAL LENGTH: All 4 options must be comparable in word count, syntax, and detail. Do NOT make the correct option noticeably longer or more detailed than distractors.
   - NO OPTION SHORTCUTS: Strictly forbid "All of the above", "None of the above", "Both A and B", or combined option choices.

7. ACADEMIC ACCURACY & SOURCE DISCIPLINE:
   - PHILOSOPHY: Distinguish arguments from facts, avoid oversimplifying theories, preserve precise terms (e.g. embodied spirit, transcendence, intersubjectivity).
   - PHILIPPINE HISTORY / SOCIAL STUDIES: Maintain strict historical accuracy. Do not fabricate events or dates. Use accurate Filipino historical terms (e.g. Katipunan, Sultanato, Galleon Trade).
   - MATHEMATICS / SCIENCE: Ensure strict logical and numerical accuracy with exactly one correct result.

8. MANDATORY INTERNAL ITEM SELF-VERIFICATION:
   Before producing final output, internally verify each item:
   - Is it in the correct target instructional language across all fields?
   - Is it strictly constrained to the instructional scope in the teacher's notes?
   - Does higher cognitive difficulty stem from deeper thinking rather than untaught facts?
   - Is the stimulus educational without leaking the correct answer?
   - Are all 4 options equal in length and detail without giveaways?
   - Are distractors credible student misconceptions?

9. REQUIRED JSON OUTPUT SCHEMA:
   Return ONLY a valid JSON object matching this schema (NO MARKDOWN, NO COMMENTS):
   {
     "identified_competency_level": "Highest permitted Bloom's level for this competency",
     "questions": [
       {
         "question": "Educational stimulus followed by clear question stem...",
         "options": [
           "Option A text",
           "Option B text",
           "Option C text",
           "Option D text"
         ],
         "answer_index": 0,
         "cognitive_level": "Remembering",
         "rationale": "Clear pedagogical explanation of why option index 0 is correct and why distractors represent common misconceptions."
       }
     ]
   }
`;

    const modelsToTry = getModelsToTry(selectedModel, useFallback);
    return await executeAiRequest(apiKey, prompt, modelsToTry, thinkingLevel || 'medium');
}

/**
 * Refines a specific segment of the DLP
 */
async function callRefineSegment(inputs) {
    const { apiKey, subject, promptText, context, selectedModel, thinkingLevel } = inputs;

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

    const modelsToTry = getModelsToTry(selectedModel, false);
    const result = await executeAiRequest(apiKey, refinePrompt, modelsToTry, thinkingLevel || 'medium');
    return result.text ? result.text.replace(/^```html\n?|```$/gm, '').trim() : null;
}

/**
 * Refines the entire assessment based on follow-up instructions
 */
async function callRefineAssessment(inputs) {
    const { apiKey, subject, currentAssessment, instruction, selectedModel, thinkingLevel } = inputs;

    const prompt = `
Act as a Professional Assessment Designer and Curriculum Specialist in ${subject}.
I have this current MCQ assessment for "${subject}":
${JSON.stringify(currentAssessment, null, 2)}

USER REFINEMENT INSTRUCTION: "${instruction}"

REFINEMENT RIGOR & INSTRUCTIONAL SCOPE INSTRUCTIONS:
1. Modify or rewrite the assessment strictly based on the user instruction.
2. PRESERVE INSTRUCTIONAL SCOPE: Each competency section inside currentAssessment has its own competency title and teacher notes. Respect each competency's distinct instructional scope. DO NOT mix concepts from one competency's notes into another.
3. COGNITIVE RIGOR: Do not lower cognitive rigor or change Bloom's Taxonomy classifications unless explicitly requested. Higher difficulty must come from deeper reasoning about taught concepts, not untaught facts.
4. STIMULUS PRESERVATION: Ensure every refined item retains an educational stimulus without revealing or paraphrasing the correct answer.
5. DISTRACTOR PARITY: Maintain 4 plausible options equal in length, syntax, and detail. Do NOT make the correct answer longer or more detailed.
6. NO SHORTCUTS: Strictly prohibit "All/None of the above" or combined option choices.
7. MAINTAIN SCHEMA & ANSWER INDEX: Return valid JSON matching the original array structure. Preserve correct answer indices unless options were rewritten.
8. LANGUAGE CONSISTENCY RULE: Maintain the established target language (Filipino/English) of each question in the assessment across all fields (stimulus, stem, options, rationale). DO NOT translate questions into another language merely because the user's follow-up instruction is written in a different language! ONLY translate if explicitly requested in the instruction.

RETURN ONLY THE UPDATED JSON. NO MARKDOWN.`;

    const modelsToTry = getModelsToTry(selectedModel, false);
    const result = await executeAiRequest(apiKey, prompt, modelsToTry, thinkingLevel || 'medium');
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
    const { apiKey, subject, competency, notes, questionItem, instruction, selectedModel, thinkingLevel } = inputs;

    const formattedNotes = (notes && typeof notes === 'string' && notes.trim().length > 0)
        ? notes.trim()
        : "[NO SPECIFIC TEACHER NOTES PROVIDED - Maintain standard grade-level curriculum boundaries.]";

    const prompt = `
Act as a Professional Assessment Designer and Curriculum Specialist in ${subject}.
I have this specific multiple-choice question for "${subject}":
${JSON.stringify(questionItem, null, 2)}

INSTRUCTIONAL CONTEXT & BOUNDARIES:
- LEARNING COMPETENCY: "${competency || 'General Competency'}"
- TEACHER'S AI GUIDANCE & NOTES (AUTHORITATIVE INSTRUCTIONAL SCOPE):
  <ai_guidance_and_notes>
  ${formattedNotes}
  </ai_guidance_and_notes>

USER INSTRUCTION FOR THIS ITEM: "${instruction}"

REFINEMENT RIGOR & SCOPE INSTRUCTIONS:
1. Modify this specific question based on the user's instruction while remaining strictly within the teacher's instructional scope in the notes.
2. DO NOT introduce untaught subject knowledge or obscure theories simply to fulfill the refinement request.
3. COGNITIVE RIGOR: Do not lower the Bloom's Taxonomy cognitive level unless requested. Higher difficulty must come from deeper thinking on taught concepts, not new untaught facts.
4. STIMULUS QUALITY: Retain an educational contextual stimulus without leaking the answer text verbatim.
5. OPTION PARITY & LENGTH: Ensure all 4 options are comparable in length, structure, and detail.
6. DISTRACTOR CREDIBILITY: Ensure the 3 distractors represent credible student misconceptions on taught material.
7. SCHEMA COMPLIANCE: Return the updated question in exact JSON schema (question, options, answer_index, cognitive_level, rationale).
8. LANGUAGE CONSISTENCY RULE: Maintain the established target language (Filipino/English) of the original question item across all fields (stimulus, stem, options, rationale). DO NOT translate or switch the language of the item merely because the user's follow-up instruction is written in another language! ONLY translate if the user's instruction explicitly requests translation (e.g. 'Isalin sa Filipino' or 'Translate to English').

RETURN ONLY THE UPDATED JSON OBJECT. NO MARKDOWN.`;

    const modelsToTry = getModelsToTry(selectedModel, false);
    const result = await executeAiRequest(apiKey, prompt, modelsToTry, thinkingLevel || 'medium');
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
async function executeAiRequest(apiKey, prompt, models, thinkingLevel = 'medium') {
    let lastError = '';
    for (const model of models) {
        try {
            const requestBody = {
                contents: [{ parts: [{ text: prompt }] }]
            };

            if (model.supportsThinking && thinkingLevel) {
                requestBody.generationConfig = {
                    thinkingConfig: {
                        thinkingLevel: thinkingLevel
                    }
                };
            }

            const response = await fetch(`https://generativelanguage.googleapis.com/${model.version}/models/${model.name}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const data = Array.isArray(response) ? response : await response.json();
            if (response.ok || data.candidates) {
                if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                    lastError = "AI safety filter triggered or empty response.";
                    continue;
                }
                const parts = data.candidates[0].content.parts || [];
                // Exclude parts marked as thinking thoughts (p.thought = true)
                const responseParts = parts.filter(p => !p.thought);
                let text = (responseParts.length > 0 ? responseParts : parts)
                    .map(p => p.text || '')
                    .filter(t => t.trim().length > 0)
                    .join('\n');

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
