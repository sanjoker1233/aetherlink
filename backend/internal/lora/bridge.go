package lora

import (
	"sync"
)

type Device struct {
	ID        string
	Name      string
	DevEUI    string
	AppEUI    string
	AppKey    string
	FCntUp    uint32
	FCntDown  uint32
	SNR       float64
	RSSI      float64
	Battery   float64
	LastHeard int64
}

type Gateway struct {
	ID      string
	Name    string
	Lat     float64
	Lng     float64
	Devices []*Device
	Status  string
}

type Bridge struct {
	mu       sync.RWMutex
	gateways map[string]*Gateway
	config   Config
}

type Config struct {
	Region          string
	Frequency       float64
	SpreadingFactor int
	Bandwidth       int
	TXPower         int
	Enabled         bool
}

func NewBridge(cfg Config) *Bridge {
	return &Bridge{
		gateways: make(map[string]*Gateway),
		config:   cfg,
	}
}

func (b *Bridge) Send(data []byte, targetID string) error {
	if !b.config.Enabled {
		return nil
	}
	return nil
}

func (b *Bridge) Receive() ([]byte, error) {
	if !b.config.Enabled {
		return nil, nil
	}
	return nil, nil
}

func (b *Bridge) GetDevices() []*Device {
	b.mu.RLock()
	defer b.mu.RUnlock()
	var devices []*Device
	for _, gw := range b.gateways {
		devices = append(devices, gw.Devices...)
	}
	return devices
}

func (b *Bridge) GetGateways() []*Gateway {
	b.mu.RLock()
	defer b.mu.RUnlock()
	var gws []*Gateway
	for _, gw := range b.gateways {
		gws = append(gws, gw)
	}
	return gws
}

func (b *Bridge) GetStatus() map[string]interface{} {
	b.mu.RLock()
	defer b.mu.RUnlock()
	totalDevices := 0
	for _, gw := range b.gateways {
		totalDevices += len(gw.Devices)
	}
	return map[string]interface{}{
		"enabled":   b.config.Enabled,
		"region":    b.config.Region,
		"frequency": b.config.Frequency,
		"sf":        b.config.SpreadingFactor,
		"gateways":  len(b.gateways),
		"devices":   totalDevices,
		"status":    "online",
	}
}
