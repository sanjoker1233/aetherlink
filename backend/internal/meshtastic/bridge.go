package meshtastic

import (
	"sync"
	"time"
)

type NodeInfo struct {
	ID        string
	Name      string
	ShortName string
	MAC       string
	Role      string
	Battery   float64
	SNR       float64
	hopCount  int32
	LastHeard time.Time
	Channel   int
	Position  Position
}

type Position struct {
	Lat      float64
	Lng      float64
	Altitude float32
}

type MeshPacket struct {
	From     string
	To       string
	Payload  []byte
	Channel  int
	HopLimit int32
	Priority int32
	ID       string
	RSSI     float64
	SNR      float64
}

type Bridge struct {
	mu      sync.RWMutex
	nodes   map[string]*NodeInfo
	config  Config
	packets chan MeshPacket
}

type Config struct {
	SerialPort  string
	BaudRate    int
	Enabled     bool
	ChannelName string
	ModemPreset string
}

func NewBridge(cfg Config) *Bridge {
	return &Bridge{
		nodes:   make(map[string]*NodeInfo),
		config:  cfg,
		packets: make(chan MeshPacket, 100),
	}
}

func (b *Bridge) SendPacket(pkt MeshPacket) error {
	if !b.config.Enabled {
		return nil
	}
	return nil
}

func (b *Bridge) GetNodes() []*NodeInfo {
	b.mu.RLock()
	defer b.mu.RUnlock()
	nodes := make([]*NodeInfo, 0, len(b.nodes))
	for _, n := range b.nodes {
		nodes = append(nodes, n)
	}
	return nodes
}

func (b *Bridge) GetNode(id string) *NodeInfo {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.nodes[id]
}

func (b *Bridge) PacketChannel() <-chan MeshPacket {
	return b.packets
}

func (b *Bridge) GetStatus() map[string]interface{} {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return map[string]interface{}{
		"enabled":      b.config.Enabled,
		"channel":      b.config.ChannelName,
		"modem_preset": b.config.ModemPreset,
		"nodes":        len(b.nodes),
		"status":       "online",
	}
}
