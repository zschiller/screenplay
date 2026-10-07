// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useToolbarReveal } from "./use-toolbar-reveal"

// jsdom has no Web Animations: record each animate() call and let the test
// finish the group's own animation by hand.
type FakeAnimation = {
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  onfinish: (() => void) | null
  cancel: () => void
}
let animations: Map<Element, FakeAnimation[]>
let reducedMotion: boolean

beforeEach(() => {
  animations = new Map()
  reducedMotion = false
  Element.prototype.animate = function (keyframes, options) {
    const animation: FakeAnimation = {
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
      onfinish: null,
      cancel: () => {
        const list = animations.get(this) ?? []
        animations.set(
          this,
          list.filter((a) => a !== animation)
        )
      },
    }
    animations.set(this, [...(animations.get(this) ?? []), animation])
    return animation as unknown as Animation
  }
  Element.prototype.getAnimations = function () {
    return (animations.get(this) ?? []) as unknown as Animation[]
  }
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        matches: query.includes("reduce") && reducedMotion,
      }) as MediaQueryList
  )
})

afterEach(cleanup)

function Bar({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const mounted = useToolbarReveal(open, ref)
  return (
    <div>
      {mounted && (
        <div ref={ref} data-testid="group">
          <button>Bullet list</button>
          <button>Image</button>
        </div>
      )}
    </div>
  )
}

const group = () => document.querySelector("[data-testid=group]")
const groupAnimation = () => animations.get(group()!)?.at(-1)

describe("useToolbarReveal", () => {
  it("shows a group the toolbar opens with at once", () => {
    render(<Bar open />)
    expect(group()).not.toBeNull()
    expect(groupAnimation()).toBeUndefined()
  })

  it("grows the group open from nothing and fades its controls in", () => {
    const { rerender } = render(<Bar open={false} />)
    expect(group()).toBeNull()
    rerender(<Bar open />)
    expect(groupAnimation()?.keyframes[0]).toMatchObject({ width: "0px" })
    const button = group()!.querySelector("button")!
    expect(animations.get(button)?.[0]?.keyframes).toEqual([
      { opacity: 0 },
      { opacity: 1 },
    ])
  })

  it("keeps the group until it has folded away", () => {
    const { rerender } = render(<Bar open />)
    rerender(<Bar open={false} />)
    expect(group()).not.toBeNull()
    expect(groupAnimation()?.keyframes.at(-1)).toMatchObject({ width: "0px" })
    act(() => groupAnimation()!.onfinish!())
    expect(group()).toBeNull()
  })

  it("opens again from where an interrupted fold had got to", () => {
    const { rerender } = render(<Bar open />)
    rerender(<Bar open={false} />)
    const fold = groupAnimation()!
    vi.spyOn(group()!, "getBoundingClientRect").mockReturnValue({
      width: 40,
    } as DOMRect)
    rerender(<Bar open />)
    expect(animations.get(group()!)).not.toContain(fold)
    expect(groupAnimation()?.keyframes[0]).toMatchObject({ width: "40px" })
    expect(group()).not.toBeNull()
  })

  it("opens and closes at once with reduced motion", () => {
    reducedMotion = true
    const { rerender } = render(<Bar open={false} />)
    rerender(<Bar open />)
    expect(group()).not.toBeNull()
    expect(groupAnimation()).toBeUndefined()
    rerender(<Bar open={false} />)
    expect(group()).toBeNull()
  })
})
