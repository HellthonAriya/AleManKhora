/**
 * AleManKhora — Quoridor engine (server side).
 *
 * The engine is pure ES with no Node dependencies, so a single canonical copy
 * lives in `public/js/engine.js` and is shared by both the server and the
 * browser client. This module simply re-exports it to keep server imports
 * stable.
 */
export * from '../../public/js/engine.js';
