# AI trust boundaries and prompt injection

Noor Note treats every note body, title, path, web clip, imported document, transcript, OCR result, search excerpt, and AI response as untrusted data. A note or clipped page can contain text that looks like a system message, a tool call, or a request for secrets. Its storage location does not make those instructions authoritative.

## Request path

| Layer | Origin and authority | Enforcement |
| --- | --- | --- |
| Application rules | Fixed code in `packages/ai/src/trust-boundary.ts` | The local model receives these in a system-role message. Rules prohibit following source instructions, requesting secrets, and initiating tools, network requests, or file changes. |
| Application task | Noor Note's built-in note action, vault answer, or organization task | The gateway accepts only the fixed built-in task strings before review or dispatch. Note text, web clips, and user questions cannot construct new tasks. |
| User request | Current question or translation target, plus at most two prior user questions | Sent in its own user-role message as JSON. Previous assistant answers are excluded. A user request cannot alter the fixed system message. |
| Retrieved content | Reviewed note passages or a selected note excerpt, including any web clip imported into it | Sent in a separate user-role message as a JSON array of text values. JSON encoding prevents source text such as `</note>` or role delimiters from changing the message structure. This is data for the requested task, not an instruction source. |
| Model output | Untrusted suggestion or answer | Runtime-validated as text. Vault answers need real citation labels. Note changes, study cards, and organization suggestions require a separate preview and explicit acceptance. No model output is interpreted as a tool call. |

`AiGateway` validates the requested vault and note IDs, policy, provider, content size, and exact reviewed content before dispatch. It rechecks the policy and provider after approval. The gateway constructs the role-separated messages and passes provider adapters only those messages, a source count, and a source character count; adapters do not receive raw vault records or a free-form prompt plan. The local worker has no tool bridge, credential API, note repository, or privileged operation handler. A model-generated URL, command, or JSON object is displayed as text and does not execute.

## Web clips and future providers

The extension captures web pages as untrusted Markdown. Importing a clip does not grant its text authority. If the resulting note is later retrieved for AI, the same source-data message and user review apply. The app does not silently send a clip to an AI provider.

No external chat provider is currently configured. A future adapter must preserve the message roles, send only the approved scope, keep credentials on a trusted server, and prohibit model-selected tools unless an application-level permission and user review authorize the specific action. A model's request for a tool is never sufficient authorization. Embedding, OCR, and transcription providers must use the same consent and data minimization boundary before any external transfer.

Prompt separation limits structural injection, but cannot prove that a language model will ignore every malicious sentence in a passage. A malicious source can also contaminate the factual answer without asking for a tool. Citation checks verify source identity, not truth. Users should inspect consequential suggestions against the original note. Real-browser adversarial model tests and an independent AI security review remain necessary before hosted providers or model tools are enabled.
