#!/usr/bin/env bash
# RunbookAI Install Script
# Usage: curl -fsSL https://userunbook.ai/install.sh | bash
#
# This script installs RunbookAI, an AI-powered SRE assistant.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
REPO_URL="https://github.com/Runbook-Agent/RunbookAI.git"
INSTALL_DIR="${RUNBOOK_INSTALL_DIR:-$HOME/.runbook}"
BIN_DIR="${RUNBOOK_BIN_DIR:-$HOME/.local/bin}"

# Banner
print_banner() {
    echo -e "${PURPLE}"
    echo ' ____              _                 _       _    ___ '
    echo '|  _ \ _   _ _ __ | |__   ___   ___ | | __  / \  |_ _|'
    echo '| |_) | | | | '\''_ \| '\''_ \ / _ \ / _ \| |/ / / _ \  | | '
    echo '|  _ <| |_| | | | | |_) | (_) | (_) |   < / ___ \ | | '
    echo '|_| \_\\__,_|_| |_|_.__/ \___/ \___/|_|\_/_/   \_\___|'
    echo -e "${NC}"
    echo -e "${CYAN}          Your AI SRE, always on call${NC}"
    echo ""
}

info() {
    echo -e "${BLUE}::${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warn() {
    echo -e "${YELLOW}!${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

# Detect OS and architecture
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Linux*)     OS=linux;;
        Darwin*)    OS=darwin;;
        MINGW*|MSYS*|CYGWIN*) OS=windows;;
        *)          error "Unsupported operating system: $OS";;
    esac

    case "$ARCH" in
        x86_64|amd64)   ARCH=x64;;
        arm64|aarch64)  ARCH=arm64;;
        *)              error "Unsupported architecture: $ARCH";;
    esac

    info "Detected platform: $OS-$ARCH"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install Bun if not present
install_bun() {
    if command_exists bun; then
        success "Bun is already installed ($(bun --version))"
        return 0
    fi

    info "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash

    # Source bun for current session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    if command_exists bun; then
        success "Bun installed successfully ($(bun --version))"
    else
        error "Failed to install Bun. Please install it manually: https://bun.sh"
    fi
}

# Check for git
check_git() {
    if ! command_exists git; then
        error "Git is required but not installed. Please install git first."
    fi
    success "Git is installed"
}

# Clone or update repository
install_runbook() {
    if [ -d "$INSTALL_DIR" ]; then
        info "Updating existing installation..."
        cd "$INSTALL_DIR"
        git fetch origin main
        git reset --hard origin/main
        success "Updated to latest version"
    else
        info "Cloning RunbookAI..."
        git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
        success "Cloned repository"
    fi

    cd "$INSTALL_DIR"

    info "Installing dependencies..."
    bun install --frozen-lockfile 2>/dev/null || bun install
    success "Dependencies installed"

    info "Building CLI..."
    bun run build
    success "Build complete"
}

# Setup PATH
setup_path() {
    # Create bin directory if needed
    mkdir -p "$BIN_DIR"

    # Create symlink
    ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/runbook"
    chmod +x "$BIN_DIR/runbook"
    success "Created symlink at $BIN_DIR/runbook"

    # Check if BIN_DIR is in PATH
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        warn "$BIN_DIR is not in your PATH"

        # Detect shell and config file
        SHELL_NAME="$(basename "$SHELL")"
        case "$SHELL_NAME" in
            bash)
                SHELL_CONFIG="$HOME/.bashrc"
                [ -f "$HOME/.bash_profile" ] && SHELL_CONFIG="$HOME/.bash_profile"
                ;;
            zsh)
                SHELL_CONFIG="$HOME/.zshrc"
                ;;
            fish)
                SHELL_CONFIG="$HOME/.config/fish/config.fish"
                ;;
            *)
                SHELL_CONFIG=""
                ;;
        esac

        if [ -n "$SHELL_CONFIG" ]; then
            echo "" >> "$SHELL_CONFIG"
            echo "# RunbookAI" >> "$SHELL_CONFIG"
            echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_CONFIG"
            success "Added $BIN_DIR to PATH in $SHELL_CONFIG"
            echo ""
            info "Run this to use runbook in current session:"
            echo -e "    ${BOLD}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
        else
            echo ""
            info "Add this to your shell config:"
            echo -e "    ${BOLD}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
        fi
    fi
}

# Print next steps
print_next_steps() {
    echo ""
    echo -e "${GREEN}${BOLD}Installation complete!${NC}"
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo ""
    echo "  1. Set your Anthropic API key:"
    echo -e "     ${CYAN}export ANTHROPIC_API_KEY=your-api-key${NC}"
    echo ""
    echo "  2. Create a config file:"
    echo -e "     ${CYAN}mkdir -p .runbook && cp $INSTALL_DIR/examples/config.yaml .runbook/config.yaml${NC}"
    echo ""
    echo "  3. Ask your first question:"
    echo -e "     ${CYAN}runbook ask \"What EC2 instances are running?\"${NC}"
    echo ""
    echo -e "${BOLD}Documentation:${NC} https://userunbook.ai/docs.html"
    echo -e "${BOLD}GitHub:${NC}        https://github.com/Runbook-Agent/RunbookAI"
    echo ""
}

# Main installation flow
main() {
    print_banner

    detect_platform
    check_git
    install_bun
    install_runbook
    setup_path
    print_next_steps
}

main "$@"
