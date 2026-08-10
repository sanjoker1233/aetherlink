package scheduler

import (
	"log"
	"sync"
	"time"
)

type LinkType int

const (
	LinkInternet  LinkType = 0
	LinkWiFiMesh  LinkType = 1
	LinkLoRa      LinkType = 2
	LinkSatellite LinkType = 3
)

type LinkPriority int

const (
	PriorityHigh   LinkPriority = 0
	PriorityNormal LinkPriority = 1
	PriorityLow    LinkPriority = 2
	PriorityBackup LinkPriority = 3
)

type Message struct {
	ID        string
	Data      []byte
	Priority  LinkPriority
	Size      int
	Timestamp time.Time
	Routes    []LinkType
}

type LinkStatus struct {
	Type      LinkType
	Available bool
	Bandwidth int
	Latency   time.Duration
	Cost      float64
	Strength  float64
}

type Scheduler struct {
	mu          sync.RWMutex
	links       map[LinkType]*LinkStatus
	queue       []*Message
	routingTable map[string][]LinkType
}

func NewScheduler() *Scheduler {
	s := &Scheduler{
		links:        make(map[LinkType]*LinkStatus),
		queue:        make([]*Message, 0),
		routingTable: make(map[string][]LinkType),
	}

	s.links[LinkInternet] = &LinkStatus{
		Type: LinkInternet, Available: true,
		Bandwidth: 1000000, Latency: 50 * time.Millisecond,
		Cost: 1.0, Strength: 100,
	}
	s.links[LinkWiFiMesh] = &LinkStatus{
		Type: LinkWiFiMesh, Available: true,
		Bandwidth: 500000, Latency: 10 * time.Millisecond,
		Cost: 0.5, Strength: 85,
	}
	s.links[LinkLoRa] = &LinkStatus{
		Type: LinkLoRa, Available: true,
		Bandwidth: 50000, Latency: 100 * time.Millisecond,
		Cost: 0.1, Strength: 70,
	}
	s.links[LinkSatellite] = &LinkStatus{
		Type: LinkSatellite, Available: true,
		Bandwidth: 500000, Latency: 600 * time.Millisecond,
		Cost: 5.0, Strength: 60,
	}

	return s
}

func (s *Scheduler) RouteMessage(msg *Message) []LinkType {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if cached, ok := s.routingTable[msg.ID]; ok {
		return cached
	}

	var candidates []struct {
		linkType LinkType
		score    float64
	}

	for _, link := range s.links {
		if !link.Available {
			continue
		}

		score := float64(link.Bandwidth) / float64(link.Latency.Milliseconds()+1)
		score *= link.Strength / 100.0
		score /= link.Cost

		candidates = append(candidates, struct {
			linkType LinkType
			score    float64
		}{link.Type, score})
	}

	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			if candidates[j].score > candidates[i].score {
				candidates[i], candidates[j] = candidates[j], candidates[i]
			}
		}
	}

	var routes []LinkType
	for _, c := range candidates {
		routes = append(routes, c.linkType)
	}

	s.routingTable[msg.ID] = routes
	return routes
}

func (s *Scheduler) Enqueue(msg *Message) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.queue = append(s.queue, msg)
	log.Printf("Message %s queued (size: %d, priority: %d)", msg.ID, msg.Size, msg.Priority)
}

func (s *Scheduler) ProcessQueue() []*Message {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.queue) == 0 {
		return nil
	}

	s.sortByPriority()

	var toSend []*Message
	var remaining []*Message

	for _, msg := range s.queue {
		if msg.Priority == PriorityBackup {
			remaining = append(remaining, msg)
			continue
		}

		routes := s.RouteMessage(msg)
		if len(routes) > 0 {
			msg.Routes = routes
			toSend = append(toSend, msg)
		} else {
			remaining = append(remaining, msg)
		}
	}

	s.queue = remaining
	return toSend
}

func (s *Scheduler) UpdateLinkStatus(linkType LinkType, status *LinkStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.links[linkType] = status
}

func (s *Scheduler) sortByPriority() {
	for i := 0; i < len(s.queue); i++ {
		for j := i + 1; j < len(s.queue); j++ {
			if s.queue[j].Priority < s.queue[i].Priority {
				s.queue[i], s.queue[j] = s.queue[j], s.queue[i]
			}
		}
	}
}

func (s *Scheduler) Start(interval time.Duration) <-chan []*Message {
	out := make(chan []*Message, 10)
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			messages := s.ProcessQueue()
			if messages != nil {
				out <- messages
			}
		}
	}()
	return out
}
