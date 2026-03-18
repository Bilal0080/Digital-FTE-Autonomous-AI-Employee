import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { VaultItem, UserProfile } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function generateCEOBriefing(vaultItems: VaultItem[], profile: UserProfile): Promise<string> {
  const model = "gemini-3-flash-preview";
  
  const context = `
    User Profile: ${JSON.stringify(profile)}
    Recent Vault Items: ${JSON.stringify(vaultItems.slice(0, 20))}
  `;

  const prompt = `
    You are a Senior Digital FTE (Full-Time Equivalent) for the user.
    Based on the provided context, generate a "Monday Morning CEO Briefing" in Markdown.
    Include:
    1. Executive Summary
    2. Revenue & Finance Update (if data available)
    3. Completed Tasks (from 'done' status)
    4. Bottlenecks (from 'pending' or 'in_progress' items that seem stuck)
    5. Proactive Suggestions (e.g., cost optimization, new leads)
    
    Keep it professional, concise, and actionable.
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: context }, { text: prompt }] }],
      config: {
        systemInstruction: "You are a proactive business partner and autonomous agent. Your goal is to provide high-level reasoning and autonomy.",
      },
    });
    return response.text || "Failed to generate briefing.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Error generating briefing. Please check your API key.";
  }
}

export async function processVaultItem(item: VaultItem, profile: UserProfile): Promise<string> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Process this vault item:
    Title: ${item.title}
    Type: ${item.type}
    Content: ${item.content}
    
    Context:
    Business Goals: ${profile.businessGoals || 'None set'}
    Rules of Engagement: ${profile.rulesOfEngagement || 'None set'}
    
    Task:
    Analyze this item and suggest a Plan.md. 
    If it's an email or message, draft a reply.
    If it's a financial transaction, categorize it.
    Return the response in Markdown.
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
    });
    return response.text || "No analysis available.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Error processing item.";
  }
}
