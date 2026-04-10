export class WalletConnectModal {
  constructor(..._args: unknown[]) {}

  openModal(): void {}

  closeModal(): void {}

  subscribeModal(_callback: (...args: unknown[]) => void): () => void {
    return () => {}
  }
}

export default WalletConnectModal
