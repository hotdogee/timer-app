/**
 * The settings dialog (spec › Settings) and what the app needs to wire it: the dialog itself, the
 * section ids, and saving or reading export files.
 */
export { default as SettingsDialog } from './SettingsDialog.svelte'
export { SECTION_IDS, isSectionId, type SectionId } from './sections'
export {
  MAX_IMPORT_BYTES,
  downloadExport,
  importFailureMessage,
  readImportFile,
  type DownloadEnvironment,
  type ImportFailure,
  type ImportFileResult,
  type ImportSource,
} from './data-file'
