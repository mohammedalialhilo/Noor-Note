import { AiGateway } from '@noor-note/ai';
import { BrowserNoteProvider } from './ai-local-provider';

export const aiGateway = new AiGateway();
aiGateway.registerChat(new BrowserNoteProvider());
