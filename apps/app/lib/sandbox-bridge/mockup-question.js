;(() => {
  // The question card a Mockup page can answer (#1644), inlined into every
  // Mockup's srcdoc beside the knobs and shared-state runtimes:
  //
  //   screenplay.question((q) => render(q))
  //   button.onclick = () => screenplay.answer(1)
  //
  // `question` calls back at once and on every change with the open question
  // its chat asked about this Mockup (`{ question, options, recommended,
  // answer, answerable }`, `answer` null until someone answers, then
  // `{ index }`), or null when there's none. `answer(index)` answers it as a
  // click on the card would, and only from a person's tap or key press: a
  // page can't speak for anyone on its own. It returns whether the answer
  // went to the canvas. `answerable` is false while it can't go (the page is
  // live and nobody has control, or the agent is driving it), so the page can
  // say to answer in the chat instead of showing a pick as sent.
  if (window.screenplay && window.screenplay.question) return

  const listeners = new Set()
  let current = null

  function notify() {
    for (const cb of listeners) {
      try {
        cb(current)
      } catch (e) {
        console.error(e)
      }
    }
  }

  function question(onChange) {
    if (typeof onChange === "function") {
      listeners.add(onChange)
      onChange(current)
    }
    return current
  }

  // A tap or key press is in progress (transient user activation).
  function fromGesture() {
    const activation = navigator.userActivation
    return !!activation && activation.isActive
  }

  function answer(index) {
    if (!fromGesture()) {
      console.warn(
        "[screenplay] answer() only works from a click or key press on the page."
      )
      return false
    }
    if (!current || current.answer || current.answerable === false) {
      return false
    }
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= current.options.length
    ) {
      return false
    }
    parent.postMessage(
      { type: "screenplay:question-answer", id: current.id, index },
      "*"
    )
    return true
  }

  window.addEventListener("message", (e) => {
    const data = e.data
    if (!data || data.type !== "screenplay:question-apply") return
    current =
      data.question && typeof data.question === "object" ? data.question : null
    notify()
  })
  parent.postMessage({ type: "screenplay:question-request" }, "*")

  window.screenplay = Object.assign(window.screenplay || {}, {
    question,
    answer,
  })
})()
