export type Resource = {
  name: string
  type: string
  host: string
  port: number
  database: string
  username: string
  autoLimitRows?: number | null
  tls?: {
    mode?: string | null
    caCertPath?: string | null
    certPath?: string | null
    keyPath?: string | null
  }
}
