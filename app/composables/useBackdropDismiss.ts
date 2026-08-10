/**
 * Close-on-click-outside for an overlay, without the drag-release false positive.
 *
 * A `click` fires on the nearest common ancestor of the mousedown and mouseup
 * targets, so selecting text inside the dialog and releasing over the backdrop
 * targets the backdrop — `@click.self` reads that as a click outside and closes
 * the form mid-edit. Requiring the press and the release to have landed on the
 * backdrop themselves makes only a real outside click count; testing either one
 * alone still closes on a drag in the other direction.
 *
 * Bind both handlers to the element that represents "outside": the
 * `.dialog-backdrop` div, or the <dialog> itself under showModal().
 *
 *   const backdrop = useBackdropDismiss(() => emit('close'))
 *   <div class="dialog-backdrop" v-on="backdrop">
 */
export function useBackdropDismiss(dismiss: () => void) {
  let pressedOutside = false
  let releasedOutside = false

  return {
    mousedown(event: MouseEvent) {
      pressedOutside = event.target === event.currentTarget
    },
    mouseup(event: MouseEvent) {
      releasedOutside = event.target === event.currentTarget
    },
    // Both flags are cleared here rather than on the next press, so a sequence
    // that never reaches a click can't leave one armed.
    click(event: MouseEvent) {
      const outside = pressedOutside && releasedOutside && event.target === event.currentTarget
      pressedOutside = false
      releasedOutside = false
      if (outside) dismiss()
    },
  }
}
