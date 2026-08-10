package mesh

type NetworkType string

const (
	NetworkInternet NetworkType = "internet"
)

type Network struct {
	ActiveType NetworkType `json:"activeType"`
}

type Simulator struct{}

func NewSimulator() *Simulator {
	return &Simulator{}
}

func (s *Simulator) Start() <-chan Network {
	c := make(chan Network, 1)
	c <- Network{ActiveType: NetworkInternet}
	return c
}

func (s *Simulator) Stop() {}

func (s *Simulator) GetNetwork() Network {
	return Network{ActiveType: NetworkInternet}
}
