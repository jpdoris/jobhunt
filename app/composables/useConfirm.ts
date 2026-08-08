export interface ConfirmRequest {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
}

interface ConfirmState {
  open: boolean
  request: ConfirmRequest | null
}

/**
 * Promise-based replacement for window.confirm, so call sites stay one-liners:
 *
 *   if (!(await ask({ title: 'Delete this?' }))) return
 *
 * The resolver lives at module scope rather than in state because a function is
 * not serializable. Only ever set from a click handler, so it is client-only and
 * never crosses an SSR request.
 */
let resolver: ((confirmed: boolean) => void) | null = null

export function useConfirm() {
  const state = useState<ConfirmState>('confirm-dialog', () => ({
    open: false,
    request: null,
  }))

  function ask(request: ConfirmRequest): Promise<boolean> {
    // A second prompt while one is open would strand the first promise.
    resolver?.(false)

    state.value = { open: true, request }
    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  function settle(confirmed: boolean) {
    state.value = { open: false, request: null }
    resolver?.(confirmed)
    resolver = null
  }

  return { state, ask, settle }
}
