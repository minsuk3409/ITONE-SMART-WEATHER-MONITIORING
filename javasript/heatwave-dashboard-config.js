/* Classic script: preserve the original JSP's global lexical bindings.
 * Values come from HTML-escaped attributes. Do not replace these with string interpolation.
 */
const ctx = document.getElementById('hwBoot').dataset.context || '';
const DISP_KEY = document.getElementById('hwBoot').dataset.dispKey || '';
const PARAM_FIELD_ID = document.getElementById('hwBoot').dataset.fieldId || '';
const PARAM_SITE_CD = document.getElementById('hwBoot').dataset.siteCd || '';
var wtabmode = 'wtabdef';
