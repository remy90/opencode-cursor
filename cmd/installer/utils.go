// cmd/installer/utils.go
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"time"
)

// getConfigDir returns ~/.config for the actual user
func getConfigDir() (string, error) {
	if sudoUser := os.Getenv("SUDO_USER"); sudoUser != "" && sudoUser != "root" {
		u, err := user.Lookup(sudoUser)
		if err == nil {
			return filepath.Join(u.HomeDir, ".config"), nil
		}
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(homeDir, ".config"), nil
}

// getActualUser returns the actual username (not root when using sudo)
func getActualUser() string {
	if sudoUser := os.Getenv("SUDO_USER"); sudoUser != "" && sudoUser != "root" {
		return sudoUser
	}
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return "unknown"
}

// detectExistingSetup checks if cursor-acp is already configured
func detectExistingSetup() (bool, string) {
	configDir, err := getConfigDir()
	if err != nil {
		return false, ""
	}

	configPath := filepath.Join(configDir, "opencode", "opencode.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return false, configPath
	}

	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return false, configPath
	}

	if providers, ok := config["provider"].(map[string]interface{}); ok {
		if _, exists := providers["cursor-acp"]; exists {
			return true, configPath
		}
	}

	return false, configPath
}

// commandExists checks if a command is available
func commandExists(cmd string) bool {
	_, err := exec.LookPath(cmd)
	return err == nil
}

// runCommand executes a command and logs output
func runCommand(name string, cmd *exec.Cmd, logFile *os.File) error {
	if logFile != nil {
		logFile.WriteString(fmt.Sprintf("[%s] Running: %s\n",
			time.Now().Format("15:04:05"), cmd.String()))
	}

	output, err := cmd.CombinedOutput()

	if logFile != nil {
		if len(output) > 0 {
			logFile.Write(output)
			logFile.WriteString("\n")
		}
		if err != nil {
			logFile.WriteString(fmt.Sprintf("[%s] Error: %v\n\n",
				time.Now().Format("15:04:05"), err))
		} else {
			logFile.WriteString(fmt.Sprintf("[%s] Success\n\n",
				time.Now().Format("15:04:05")))
		}
		logFile.Sync()
	}

	return err
}

// validateJSON checks if a file contains valid JSON
func validateJSON(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	var js interface{}
	if err := json.Unmarshal(data, &js); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}

	return nil
}

// cursorAgentLoggedIn checks if cursor-agent is logged in
func cursorAgentLoggedIn() bool {
	cmd := exec.Command("cursor-agent", "whoami")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return !strings.Contains(string(output), "Not logged in")
}

func getProjectDir() string {
	if envDir := os.Getenv("OPENCODE_CURSOR_PROJECT_DIR"); envDir != "" {
		return envDir
	}
	if cwd, err := os.Getwd(); err == nil {
		for {
			if _, err := os.Stat(filepath.Join(cwd, "package.json")); err == nil {
				return cwd
			}
			parent := filepath.Dir(cwd)
			if parent == cwd {
				break
			}
			cwd = parent
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}
