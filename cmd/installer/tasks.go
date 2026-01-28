package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type model struct {
	configPath      string
	pluginDir      string
	projectDir     string
	backupFiles    map[string][]byte
}

func validateConfig(m *model) error {
	return nil
}
