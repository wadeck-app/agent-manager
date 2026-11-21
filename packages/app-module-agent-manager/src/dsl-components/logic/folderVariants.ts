/**
 * The five ways to choose the folder of a new session (todo #63), the options of the A/B test `folder-picker` in the dock. They share the same data routes
 * (GET /folders/roots, /list, /search, /recent) and the same Folder field.
 *
 * The first one the dock lists is not the default: `smart` is, see DEFAULT_FOLDER_PICKER.
 */
export const FOLDER_PICKER_VARIANTS = [
  { id: 'tree', label: 'V1 Tree', hint: 'An expandable tree from the browsable roots, read folder by folder when opened (the explorer of a code editor). Arrows open, close and walk it; a filter box narrows the open folders.' },
  { id: 'columns', label: 'V2 Columns', hint: 'Miller columns (Finder, yazi): the roots, then the subfolders of the selected folder, left to right. Up and Down walk a column, Right goes into the next one, Left back.' },
  { id: 'smart', label: 'V3 Smart list', hint: 'Pinned and recent folders, and a fuzzy search over the known projects, with the branch of each. No browsing. Default: the common case is to start again in a project you already use, it needs no configuration and reads the least of the disk.' },
  { id: 'explorer', label: 'V4 Explorer', hint: 'A path bar (click a segment), an Up button, a switch between the roots and one list of the subfolders: the file dialog everybody knows.' },
  { id: 'palette', label: 'V5 Palette', hint: 'The Folder field completes the path while you type, like a shell: Tab completes the next folder, the matching subfolders and recent folders are listed under it.' },
] as const;

export type FolderPickerVariant = (typeof FOLDER_PICKER_VARIANTS)[number]['id'];

/** The variant shown when the user chose none (and the one a build without the dock always shows). */
export const DEFAULT_FOLDER_PICKER: FolderPickerVariant = 'smart';
