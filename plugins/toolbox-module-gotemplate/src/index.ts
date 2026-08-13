/// <reference types="@backstage/cli/asset-types" />

/**
 * A Go template playground for the Backstage toolbox, backed by the real Go
 * text/template engine compiled to WebAssembly.
 *
 * @packageDocumentation
 */

export { GoTemplatePlayground } from './components/GoTemplatePlayground';
export { gotemplateTool, default } from './alpha';
export type {
  DataFormat,
  ErrorPhase,
  FunctionCatalog,
  FunctionSet,
  GoTemplateEngine,
  MissingKeyMode,
  RenderRequest,
  RenderResponse,
} from './engine';
export { FUNCTION_SETS, loadEngine } from './engine';
