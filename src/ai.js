/* ------------------------------------------------------------------ */
/*  AI document assistant                                              */
/*                                                                    */
/*  Reads an uploaded PDF or image with Claude and suggests a title,  */
/*  document type, which property it belongs to, and an expiry date.  */
/*                                                                    */
/*  The call goes straight from the browser to Claude using the key   */
/*  you store in Settings — there is no server. That's only sensible  */
/*  because the app is private to your two accounts; the key never    */
/*  ships in the public bundle. The "dangerous-direct-browser-access" */
/*  header is what Anthropic requires to allow browser calls.         */
/*                                                                    */
/*  Swap MODEL to "claude-haiku-4-5" to pay a fraction of a cent per  */
/*  document at slightly lower accuracy.                              */
/* ------------------------------------------------------------------ */
const MODEL = "claude-opus-4-8";
const API_URL = "https://api.anthropic.com/v1/messages";

// Image types Claude can read directly. PDFs go through the document block.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export function canAnalyze(file) {
  return !!file && (file.type === "application/pdf" || IMAGE_TYPES.includes(file.type));
}

// Read a File into the bare base64 string (no data: prefix) the API expects.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

const DOC_TYPE_IDS = ["lease", "insurance", "deed", "inspection", "tax", "other"];

/**
 * Ask Claude to describe an uploaded document.
 * @returns {Promise<{title,type,propertyId,expiryDate}>}
 */
export async function suggestDocMeta({ apiKey, file, properties = [] }) {
  if (!apiKey) throw new Error("No Claude API key set.");
  if (!canAnalyze(file)) throw new Error("Only PDFs and images can be auto-filled.");

  const data = await fileToBase64(file);
  const fileBlock = file.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: file.type, data } };

  // Let Claude pick from the actual properties; "" means "General / not property-specific".
  const propLines = properties.length
    ? properties.map((p) => `- id "${p.id}": ${p.name}${p.address ? ` (${p.address})` : ""}`).join("\n")
    : "(no properties set up yet)";

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system:
        "You label property-management documents. Given a document and a list of the user's " +
        "rental properties, return a concise human-friendly title, the best-fitting document type, " +
        "which property it relates to, and any renewal/expiry date you can find. " +
        `Today is ${new Date().toISOString().slice(0, 10)}.`,
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            {
              type: "text",
              text:
                `Properties:\n${propLines}\n\n` +
                "Suggest metadata for this document.\n" +
                "- title: short and specific, e.g. \"2025 lease – Sosúa 2B\" (max ~60 chars).\n" +
                `- type: one of ${DOC_TYPE_IDS.join(", ")}.\n` +
                "- propertyId: the matching id from the list, or \"\" if it isn't specific to one property.\n" +
                "- expiryDate: the renewal/expiry/end date as YYYY-MM-DD, or \"\" if there is none.",
            },
          ],
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          name: "doc_meta",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title", "type", "propertyId", "expiryDate"],
            properties: {
              title: { type: "string" },
              type: { type: "string", enum: DOC_TYPE_IDS },
              propertyId: { type: "string", enum: ["", ...properties.map((p) => p.id)] },
              expiryDate: { type: "string" },
            },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    let msg = `Claude API error ${res.status}`;
    try { msg = (await res.json())?.error?.message || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }

  const json = await res.json();
  const text = json.content?.find((b) => b.type === "text")?.text || "{}";
  const meta = JSON.parse(text);

  // Guard the values before they reach the form.
  const validType = DOC_TYPE_IDS.includes(meta.type) ? meta.type : "other";
  const validProp = properties.some((p) => p.id === meta.propertyId) ? meta.propertyId : "";
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(meta.expiryDate || "") ? meta.expiryDate : "";
  return {
    title: (meta.title || "").slice(0, 120),
    type: validType,
    propertyId: validProp,
    expiryDate: validDate,
  };
}
