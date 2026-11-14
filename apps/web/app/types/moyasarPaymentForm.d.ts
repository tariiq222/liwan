// The package's own typings cannot be resolved through its `exports` map (its `types` entry is not exported), so the one call this
// application makes is declared here, with the options the pay page passes (see `moyasarFormConfig` in utils/cardPayment.ts).
declare module 'moyasar-payment-form' {
  export interface MoyasarFormConfig {
    element: HTMLElement
    language: 'ar' | 'en'
    use_payment_intent: boolean
    payment_intent: { id: string; client_secret: string }
    publishable_api_key: string
    methods: string[]
    supported_networks: string[]
    credit_card: { save_card: boolean }
    amount: number
    currency: string
    description: string
    callback_url: string
    /** Only a way for the server to find the payment later; it proves nothing and is verified server-side. */
    metadata?: { attempt_id: string }
    on_failure: (failure: { type?: string }) => Promise<void>
  }
  export default class Moyasar {
    static init(config: MoyasarFormConfig): void
  }
}
