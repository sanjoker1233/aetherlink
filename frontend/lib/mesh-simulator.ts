import type { NetworkNode, NetworkLink, MeshNetwork, NetworkType } from './types'
import { generateId } from './crypto'

export class MeshSimulator {
  private nodes: NetworkNode[] = []
  private links: NetworkLink[] = []
  private interval: ReturnType<typeof setInterval> | null = null
  private onUpdate: ((network: MeshNetwork) => void) | null = null

  private readonly names = [
    'Node-Alpha', 'Node-Beta', 'Node-Gamma', 'Node-Delta',
    'Node-Epsilon', 'Node-Zeta', 'Mesh-Gateway-1', 'Mesh-Gateway-2',
    'LoRa-Relay-1', 'LoRa-Relay-2', 'Sat-Relay', 'Mobile-Node',
  ]

  private readonly positions: [number, number][] = [
    [48.8566, 2.3522], [48.8584, 2.2945], [48.8606, 2.3376],
    [48.8738, 2.2950], [48.8534, 2.3488], [48.8867, 2.3431],
    [48.8900, 2.3700], [48.8400, 2.3200], [48.8700, 2.3100],
    [48.8450, 2.3800], [48.8800, 2.3600], [48.8600, 2.3000],
  ]

  start(onUpdate: (network: MeshNetwork) => void) {
    this.onUpdate = onUpdate
    this.initializeNodes()
    this.simulateConnections()
    this.emit()

    this.interval = setInterval(() => {
      this.simulateChanges()
      this.simulateConnections()
      this.emit()
    }, 3000)

    return () => { if (this.interval) clearInterval(this.interval) }
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null }
  }

  private initializeNodes() {
    this.nodes = this.names.map((name, i) => ({
      id: generateId(),
      name,
      type: (i < 2 ? 'gateway' : i < 6 ? 'repeater' : 'client') as NetworkNode['type'],
      network: this.randomNetwork(),
      strength: 30 + Math.random() * 70,
      lat: this.positions[i][0] + (Math.random() - 0.5) * 0.05,
      lng: this.positions[i][1] + (Math.random() - 0.5) * 0.05,
      status: 'online' as const,
      lastHeard: Date.now(),
      hops: Math.floor(Math.random() * 4),
      battery: 50 + Math.random() * 50,
    }))
  }

  private simulateConnections() {
    this.links = []
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        if (this.nodes[i].status === 'offline' || this.nodes[j].status === 'offline') continue
        if (Math.random() > 0.6) continue
        const dist = this.calculateDistance(
          this.nodes[i].lat!, this.nodes[i].lng!,
          this.nodes[j].lat!, this.nodes[j].lng!
        )
        if (dist > 5) continue
        const t: NetworkType = this.nodes[i].network === this.nodes[j].network ? this.nodes[i].network : 'hybrid'
        this.links.push({
          source: this.nodes[i].id, target: this.nodes[j].id,
          type: t, quality: 30 + Math.random() * 70, latency: 10 + Math.random() * 100,
        })
      }
    }
  }

  private simulateChanges() {
    this.nodes = this.nodes.map((n) => ({
      ...n,
      strength: Math.max(0, Math.min(100, n.strength + (Math.random() - 0.5) * 20)),
      status: Math.random() > 0.05 ? 'online' as const : (Math.random() > 0.5 ? 'degraded' as const : 'offline' as const),
      lastHeard: Date.now(),
      battery: Math.max(0, n.battery! - Math.random() * 2),
      hops: Math.max(0, n.hops + (Math.random() > 0.5 ? 1 : -1)),
    }))
    if (Math.random() > 0.7) {
      const idx = Math.floor(Math.random() * this.nodes.length)
      this.nodes[idx] = { ...this.nodes[idx], network: this.randomNetwork() }
    }
  }

  private emit() {
    if (this.onUpdate) {
      this.onUpdate({
        nodes: [...this.nodes], links: [...this.links],
        activeType: this.determineActiveNetwork(), isSimulated: true,
      })
    }
  }

  private determineActiveNetwork(): NetworkType {
    const counts: Record<string, number> = {}
    this.nodes.forEach((n) => {
      if (n.status !== 'offline') counts[n.network] = (counts[n.network] || 0) + 1
    })
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'internet') as NetworkType
  }

  private randomNetwork(): NetworkType {
    return (['lora', 'wifi', 'mesh', 'satellite', 'internet'] as NetworkType[])[Math.floor(Math.random() * 5)]
  }

  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; const dLat = this.toRad(lat2 - lat1); const dLng = this.toRad(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  private toRad = (deg: number) => deg * Math.PI / 180
}
