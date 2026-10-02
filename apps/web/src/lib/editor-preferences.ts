export interface EditorPreferences {
  lineNumbers: boolean;
  spellcheck: boolean;
  wordWrap: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  fontFamily: 'sans' | 'serif' | 'mono';
  fontSize: number;
  lineHeight: number;
}

export const defaultEditorPreferences: EditorPreferences = {
  lineNumbers: false,
  spellcheck: true,
  wordWrap: true,
  focusMode: false,
  typewriterMode: false,
  fontFamily: 'sans',
  fontSize: 14,
  lineHeight: 1.85,
};
