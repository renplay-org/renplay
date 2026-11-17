import './Logo.css'

/** The mark and the drawn wordmark, the app's name. Put inside a `.logo`, which sets their heights. */
export function Logo() {
  return (
    <>
      <img src="/favicon.svg" alt="" />
      <img className="wordmark" src="/wordmark.svg" alt="Renplay" />
    </>
  )
}
