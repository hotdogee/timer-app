/**
 * The `<style id="theme">` element that holds the color theme. Separate from the scheme generator,
 * so startup can write the precomputed default theme without loading the color library.
 */

/** Id of the `<style>` element that holds the generated theme. */
export const THEME_STYLE_ID = 'theme'

/** The parts of `Document` that writing the theme uses. */
export type ThemeDocument = Pick<
  Document,
  'getElementById' | 'createElement' | 'head' | 'querySelectorAll'
>

/**
 * Writes `css` into `<style id="theme">` in `<head>`, creating the element the first time and
 * replacing its contents after that.
 */
export function writeThemeStyle(css: string, doc: ThemeDocument = document): void {
  let style = doc.getElementById(THEME_STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = THEME_STYLE_ID
    doc.head.append(style)
  }
  style.textContent = css
}
