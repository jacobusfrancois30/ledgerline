// src/gemini.js - Gemini REST API integration for receipt scanning, bank alert parsing, smart categorize, ask money, and monthly review
'use strict';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const AVAILABLE_MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Recommended - Latest & Fast)' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Stable Fallback)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }
];

export class GeminiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
  }
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Models the key can actually use, filled in by testApiKey() for the model picker
export let discoveredModels = [];

/**
 * Core caller for Gemini REST generateContent API
 */
const sleep = ms => new Promise(res => setTimeout(res, ms));

// fetch() never gives up on its own, so a request Google doesn't answer would
// spin forever. Abort after `ms` and report it as a timeout.
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GeminiError(`Gemini didn’t answer within ${Math.round(ms / 1000)} seconds. Check your connection, or pick a different model in Setup.`, 'TIMEOUT');
    }
    throw new GeminiError('Network error connecting to Gemini API. Check your internet connection.', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

// Turn an error response into a message that says what to fix
async function errorFromResponse(response, model) {
  let errData = {};
  try { errData = await response.json(); } catch {}
  const apiMsg = errData.error?.message || response.statusText || '';
  const s = response.status;
  if (s === 404) {
    return new GeminiError(`The model "${model}" isn’t available for your key. Tap Test connection to find one that works, or pick another model in Setup.`, 'MODEL_NOT_FOUND');
  }
  if (s === 401 || s === 403 || (s === 400 && /api key|API_KEY|credential|unauthenticated/i.test(apiMsg))) {
    return new GeminiError('Google rejected this API key. Copy the key again from aistudio.google.com/app/apikey (the Gemini API key, not a token or client ID) and paste it with Replace key.', 'AUTH_ERROR');
  }
  if (s === 429) return new GeminiError('Gemini rate limit or free quota reached. Wait a minute and try again.', 'RATE_LIMIT');
  if (s === 503) return new GeminiError('Google’s servers are busy right now (503). Try again shortly, or pick a different model in Setup.', 'HIGH_DEMAND');
  return new GeminiError(`Gemini error (${s}): ${apiMsg}`.trim(), 'API_ERROR');
}

export async function callGemini({
  apiKey,
  model = DEFAULT_MODEL,
  contents,
  systemInstruction,
  generationConfig,
  stream = false,
  onChunk,
  retryCount = 0,
  timeoutMs = stream ? 90000 : 60000
}) {
  if (!navigator.onLine) {
    throw new GeminiError('You appear to be offline. Connect to the internet to use AI features.', 'OFFLINE');
  }

  if (!apiKey || !apiKey.trim()) {
    throw new GeminiError('Please add your Gemini API key in Setup to use this feature.', 'NO_KEY');
  }

  const endpoint = stream
    ? `${API_BASE}/models/${model}:streamGenerateContent?alt=sse`
    : `${API_BASE}/models/${model}:generateContent`;

  const body = {
    contents
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  if (generationConfig) {
    body.generationConfig = generationConfig;
  }

  // Receipt photos and long answers can take a while; nothing should hang forever
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.trim()
    },
    body: JSON.stringify(body)
  }, timeoutMs);

  // Handle transient 503 (high demand) or 429 with automatic retry
  if (!response.ok && (response.status === 503 || response.status === 429) && retryCount < 2) {
    await sleep(1500 * (retryCount + 1));
    return callGemini({
      apiKey,
      model,
      contents,
      systemInstruction,
      generationConfig,
      stream,
      onChunk,
      retryCount: retryCount + 1,
      timeoutMs
    });
  }

  if (!response.ok) {
    throw await errorFromResponse(response, model);
  }

  if (stream && response.body && typeof onChunk === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial line

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;
          try {
            const data = JSON.parse(jsonStr);
            const partText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (partText) {
              accumulatedText += partText;
              onChunk(partText, accumulatedText);
            }
          } catch {}
        }
      }
    }
    return accumulatedText;
  } else {
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new GeminiError('No response content returned by Gemini.', 'EMPTY_RESPONSE');
    }
    return text;
  }
}

/**
 * Image downscaling utility for receipt photos
 */
export async function downscaleImage(file, maxEdge = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxEdge || height > maxEdge) {
        if (width > height) {
          height = Math.round((height * maxEdge) / width);
          width = maxEdge;
        } else {
          width = Math.round((width * maxEdge) / height);
          height = maxEdge;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, mimeType: 'image/jpeg', dataUrl });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image file for processing.'));
    };
    img.src = url;
  });
}

/**
 * 5a. Receipt Scanner
 */
export async function scanReceipt({ apiKey, model, imageBase64, categories, currentCurrency = 'ZAR' }) {
  const catListStr = categories
    .filter(c => c.kind === 'expense')
    .map(c => `id: "${c.id}" (${c.name})`)
    .join(', ');

  const systemInstruction = `You are a receipt extraction engine for Ledgerline personal finance app.
Analyze the receipt image carefully. Extract the merchant/store name, transaction date (in YYYY-MM-DD format; if year is missing use the current year), total amount paid, currency symbol or code (default to ${currentCurrency} if not specified), line items with names and amounts, and select the best matching category id from this available list: [${catListStr}].
Output strictly valid JSON matching the schema.`;

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        merchant: { type: 'STRING', description: 'Name of the business or store' },
        date: { type: 'STRING', description: 'Transaction date in YYYY-MM-DD format' },
        total: { type: 'NUMBER', description: 'Total receipt amount paid' },
        currency: { type: 'STRING', description: 'Currency code or symbol' },
        category_guess: { type: 'STRING', description: 'Chosen category id from the provided list' },
        line_items: {
          type: 'ARRAY',
          description: 'Individual purchased items',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING' },
              amount: { type: 'NUMBER' }
            },
            required: ['name', 'amount']
          }
        }
      },
      required: ['merchant', 'total']
    }
  };

  const contents = [
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64
          }
        },
        {
          text: `Extract receipt data. Currency context: ${currentCurrency}. Choose best category id from: ${catListStr}.`
        }
      ]
    }
  ];

  const rawJson = await callGemini({
    apiKey,
    model,
    contents,
    systemInstruction,
    generationConfig
  });

  return JSON.parse(rawJson);
}

/**
 * 5b. Paste Bank Alerts (SMS / Emails)
 */
export async function parseBankAlerts({ apiKey, model, alertText, accounts, categories, currentCurrency = 'ZAR' }) {
  const acctNames = accounts.map(a => a.name).join(', ');
  const catListStr = categories.map(c => `id: "${c.id}" (${c.name})`).join(', ');

  const systemInstruction = `You are a financial message parser for South African and global bank notifications (e.g., FNB, Capitec, Nedbank, Standard Bank, Absa, Chase, Monzo).
The user provides one or more bank notification SMS or email alerts.
Extract every individual transaction found.
For each transaction:
- date: formatted as YYYY-MM-DD. If year is missing, assume current year.
- payee: cleaned merchant or recipient name (remove clutter like "POS", "CARD", "PURCHASE", reference numbers).
- amount: positive numeric amount.
- direction: "debit" (money spent/withdrawn/fees) or "credit" (deposit, salary, refund, transfer received).
- account_hint: matched account name if referenced (available accounts: [${acctNames}]), otherwise empty string.
- category_guess: matching category id from [${catListStr}].
Output strictly valid JSON matching the schema.`;

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'ARRAY',
      description: 'Extracted list of bank alert transactions',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: 'ISO date YYYY-MM-DD' },
          payee: { type: 'STRING', description: 'Cleaned merchant or beneficiary name' },
          amount: { type: 'NUMBER', description: 'Positive transaction amount' },
          direction: { type: 'STRING', enum: ['debit', 'credit'] },
          account_hint: { type: 'STRING', description: 'Hinted account name or last digits' },
          category_guess: { type: 'STRING', description: 'Suggested category id' }
        },
        required: ['date', 'payee', 'amount', 'direction']
      }
    }
  };

  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `Extract all transactions from these bank alerts:\n\n${alertText}`
        }
      ]
    }
  ];

  const rawJson = await callGemini({
    apiKey,
    model,
    contents,
    systemInstruction,
    generationConfig
  });

  return JSON.parse(rawJson);
}

/**
 * Bank statement PDF (any bank, including scanned statements)
 */
export async function parseStatementPdf({ apiKey, model, pdfBase64, currentCurrency = 'ZAR' }) {
  const systemInstruction = `You extract transactions from bank statement PDFs (FNB, Capitec, Absa, Nedbank, Standard Bank, Discovery, TymeBank and others).
Return every transaction line in the statement's transaction table, in order. Ignore opening/closing balances, totals, fee summaries and adverts.
For each transaction:
- date: YYYY-MM-DD. Use the statement period to work out the year when lines only show day and month.
- payee: the description as printed, without card numbers or reference numbers.
- amount: the transaction amount as a positive number (not the running balance).
- direction: "credit" for money in (on FNB statements these amounts end in "Cr"), otherwise "debit".
Amounts are in ${currentCurrency}. Output strictly valid JSON matching the schema.`;

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          payee: { type: 'STRING' },
          amount: { type: 'NUMBER' },
          direction: { type: 'STRING', enum: ['debit', 'credit'] }
        },
        required: ['date', 'payee', 'amount', 'direction']
      }
    }
  };

  const contents = [{
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
      { text: 'Extract all transactions from this bank statement.' }
    ]
  }];

  const rawJson = await callGemini({ apiKey, model, contents, systemInstruction, generationConfig, timeoutMs: 120000 });
  return JSON.parse(rawJson);
}

/**
 * 5c. Smart Categorize Uncategorized Payees
 */
export async function smartCategorize({ apiKey, model, uniquePayees, categories }) {
  const catList = categories
    .filter(c => c.kind !== 'transfer')
    .map(c => ({ id: c.id, name: c.name, kind: c.kind }));

  const systemInstruction = `You are an automated transaction categorization assistant for Ledgerline.
Given a list of merchant/payee names and available categories, classify each payee into the best category.
Output strictly valid JSON matching the schema.`;

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          payee: { type: 'STRING' },
          categoryId: { type: 'STRING' },
          confidence: { type: 'NUMBER', description: 'Confidence score from 0.0 to 1.0' }
        },
        required: ['payee', 'categoryId', 'confidence']
      }
    }
  };

  const prompt = `Available categories:\n${JSON.stringify(catList)}\n\nPayees to categorize:\n${JSON.stringify(uniquePayees)}`;

  const contents = [
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ];

  const rawJson = await callGemini({
    apiKey,
    model,
    contents,
    systemInstruction,
    generationConfig
  });

  return JSON.parse(rawJson);
}

/**
 * 5d. Ask About My Money (with streaming support)
 */
export async function askAboutMoney({ apiKey, model, query, summaryData, onChunk }) {
  const systemInstruction = `You are the friendly, perceptive financial assistant inside Ledgerline, a personal budgeting app.
Answer the user's question using the provided ledger summary.
Guidelines:
1. Be specific and cite numbers in ${summaryData.currency}.
2. Name specific categories, merchants, and dates.
3. Suggest concrete actions inside the app (e.g. adjust budgets, track recurring subscriptions as bills, allocate unbudgeted income to goals, set auto-categorize rules).
4. Keep the response concise, clear, and under 180 words.
5. Plain conversational formatting with bullet points where helpful.
6. Important: You provide general budgeting guidance, not accredited financial or investment advice.`;

  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `LEDGER SUMMARY DATA:\n${JSON.stringify(summaryData, null, 2)}\n\nUSER QUESTION: ${query}`
        }
      ]
    }
  ];

  return callGemini({
    apiKey,
    model,
    contents,
    systemInstruction,
    stream: true,
    onChunk
  });
}

/**
 * 5e. Monthly Financial Review
 */
export async function generateMonthlyReview({ apiKey, model, summaryData, monthName }) {
  const systemInstruction = `You are the financial reviewer inside Ledgerline.
Provide a concise, encouraging, and actionable monthly financial review for ${monthName}.
Extract:
- wins: 2-3 specific accomplishments (e.g. stayed under budget on groceries, high savings rate, paid bills on time).
- overspends: 1-2 categories or habits that exceeded budget or spiked compared to previous months.
- action: exactly 1 concrete next step the user can take right now.
- summaryText: a brief 2-sentence encouraging synthesis citing amounts in ${summaryData.currency}.`;

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        summaryText: { type: 'STRING' },
        wins: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        },
        overspends: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        },
        action: { type: 'STRING' }
      },
      required: ['summaryText', 'wins', 'overspends', 'action']
    }
  };

  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `Review my finances for ${monthName} based on this ledger data:\n${JSON.stringify(summaryData, null, 2)}`
        }
      ]
    }
  ];

  const rawJson = await callGemini({
    apiKey,
    model,
    contents,
    systemInstruction,
    generationConfig
  });

  return JSON.parse(rawJson);
}

/**
 * Test API key validity
 */
// Checks the key by listing the models it can use (fast, uses no quota), then
// checks the chosen model is one of them. Resolves { model, switchedFrom }:
// if the chosen model isn't available, it picks the best Flash model instead.
export async function testApiKey(apiKey, model = DEFAULT_MODEL) {
  if (!navigator.onLine) {
    throw new GeminiError('You appear to be offline. Connect to the internet and try again.', 'OFFLINE');
  }
  if (!apiKey || !apiKey.trim()) {
    throw new GeminiError('Add your Gemini API key first.', 'NO_KEY');
  }

  const response = await fetchWithTimeout(`${API_BASE}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': apiKey.trim() }
  }, 15000);
  if (!response.ok) throw await errorFromResponse(response, model);

  const data = await response.json();
  const usable = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({ id: String(m.name || '').replace(/^models\//, ''), name: m.displayName || m.name }))
    .filter(m => /^gemini-/.test(m.id) && !/(image|tts|audio|live|embedding|vision|robotics|computer-use)/i.test(m.id));
  discoveredModels = usable;

  if (usable.some(m => m.id === model)) return { model, switchedFrom: null };

  // Prefer a stable Flash model, newest version first
  const ver = id => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const pick = [...usable]
    .filter(m => /flash/.test(m.id))
    .sort((a, b) => (/(preview|exp|lite)/.test(a.id) - /(preview|exp|lite)/.test(b.id)) || ver(b.id) - ver(a.id))[0] || usable[0];
  if (!pick) {
    throw new GeminiError('Your key works, but it has no Gemini text models available. Check the key’s project in Google AI Studio.', 'MODEL_NOT_FOUND');
  }
  return { model: pick.id, switchedFrom: model };
}
