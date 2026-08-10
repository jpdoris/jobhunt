import { describe, expect, it, vi } from 'vitest'
import { useBackdropDismiss } from '../app/composables/useBackdropDismiss'

/**
 * Exercised without a DOM: the handlers only ever compare `target` to
 * `currentTarget`, so two sentinel objects standing in for the backdrop and the
 * dialog cover the whole decision.
 *
 * `drag` reproduces the browser's event sequence including the part that caused
 * the original bug — `click` fires on the nearest common ancestor of the press
 * and release targets, so a drag between the dialog and the backdrop reports the
 * backdrop as its target even though nothing was clicked there.
 */

const backdrop = { id: 'backdrop' }
const dialog = { id: 'dialog' }

type Handlers = ReturnType<typeof useBackdropDismiss>

function drag(handlers: Handlers, from: object, to: object) {
  const at = (target: object) => ({ target, currentTarget: backdrop }) as unknown as MouseEvent
  handlers.mousedown(at(from))
  handlers.mouseup(at(to))
  handlers.click(at(from === to ? from : backdrop))
}

describe('useBackdropDismiss', () => {
  it('closes when the press and the release are both on the backdrop', () => {
    const dismiss = vi.fn()
    drag(useBackdropDismiss(dismiss), backdrop, backdrop)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('stays open when a drag starts in the dialog and ends on the backdrop', () => {
    // Selecting text in a textarea and releasing past the edge of the form.
    const dismiss = vi.fn()
    drag(useBackdropDismiss(dismiss), dialog, backdrop)
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('stays open when a drag starts on the backdrop and ends in the dialog', () => {
    const dismiss = vi.fn()
    drag(useBackdropDismiss(dismiss), backdrop, dialog)
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('stays open for a click inside the dialog', () => {
    const dismiss = vi.fn()
    drag(useBackdropDismiss(dismiss), dialog, dialog)
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('does not let one press count towards a later click', () => {
    const dismiss = vi.fn()
    const handlers = useBackdropDismiss(dismiss)

    drag(handlers, backdrop, backdrop)
    drag(handlers, dialog, backdrop)

    expect(dismiss).toHaveBeenCalledTimes(1)
  })
})
