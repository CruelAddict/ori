#!/usr/bin/env bash
set -euo pipefail

APP=ori

RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m' # No Color

usage() {
    cat <<EOF
Ori Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    make install
    ./scripts/install.sh
    ./scripts/install.sh --no-modify-path
EOF
}

no_modify_path=false
path_updated=false
path_updated_file=""
path_update_command=""

while [[ $# -gt 0 ]]; do
    case "$1" in
    -h | --help)
        usage
        exit 0
        ;;
    --no-modify-path)
        no_modify_path=true
        shift
        ;;
    *)
        echo -e "${ORANGE}Warning: Unknown option '$1'${NC}" >&2
        shift
        ;;
    esac
done

print_message() {
    local level=$1
    local message=$2
    local color=""

    case $level in
    info) color="${NC}" ;;
    warning) color="${NC}" ;;
    error) color="${RED}" ;;
    esac

    echo -e "${color}${message}${NC}"
}

release_in_use() {
    local release=$1
    local tui_bin="$release/bin/ori"
    local be_bin="$release/libexec/ori-be"

    if ! command -v lsof >/dev/null 2>&1; then
        return 0
    fi

    if lsof -t "$tui_bin" "$be_bin" >/dev/null 2>&1; then
        return 0
    fi

    return 1
}

INSTALL_ROOT=$HOME/.ori
INSTALL_DIR=$INSTALL_ROOT/bin
RELEASES_DIR=$INSTALL_ROOT/releases
CURRENT_LINK=$INSTALL_ROOT/current

print_message info "Installing ${APP}..."
print_message info ""

print_message info "Building all components..."
make build

if [ ! -f "apps/ori-tui/bin/ori" ]; then
    print_message error "Error: built binary not found at apps/ori-tui/bin/ori"
    exit 1
fi

if [ ! -f "apps/ori-be/bin/ori-be" ]; then
    print_message error "Error: built binary not found at apps/ori-be/bin/ori-be"
    exit 1
fi

mkdir -p "$INSTALL_DIR"
mkdir -p "$RELEASES_DIR"

release_id="$(date -u +%Y%m%d%H%M%S)-$RANDOM$RANDOM"
tmp_release="$RELEASES_DIR/.tmp-$release_id"
release_dir="$RELEASES_DIR/$release_id"

mkdir -p "$tmp_release/bin"
mkdir -p "$tmp_release/libexec"

cp "apps/ori-tui/bin/ori" "$tmp_release/bin/ori"
cp "apps/ori-be/bin/ori-be" "$tmp_release/libexec/ori-be"
chmod 755 "$tmp_release/bin/ori"
chmod 755 "$tmp_release/libexec/ori-be"

mv "$tmp_release" "$release_dir"

ln -sfn "$release_dir" "$CURRENT_LINK"

resolved_current="$(cd "$CURRENT_LINK" && pwd -P)"
if [ "$resolved_current" != "$release_dir" ]; then
    print_message error "Error: failed to update current release symlink"
    exit 1
fi

cat >"$INSTALL_DIR/ori" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ORI_HOME="${ORI_HOME:-$HOME/.ori}"
CURRENT_LINK="$ORI_HOME/current"

if [ ! -d "$CURRENT_LINK" ]; then
  echo "ori is not installed correctly: missing $CURRENT_LINK" >&2
  exit 1
fi

release_dir="$(cd "$CURRENT_LINK" && pwd -P)"
exec "$release_dir/bin/ori" "$@"
EOF
chmod 755 "$INSTALL_DIR/ori"

# Keep current release and prune old releases as soon as they are unused.
current_release="$(cd "$CURRENT_LINK" && pwd -P)"
while IFS= read -r path; do
    if [ ! -d "$path" ]; then
        continue
    fi
    real_path="$(cd "$path" && pwd -P)"
    if [ "$real_path" = "$current_release" ]; then
        continue
    fi

    if release_in_use "$real_path"; then
        print_message warning "Keeping in-use release: $real_path"
        continue
    fi

    rm -rf "$path"
done < <(ls -1dt "$RELEASES_DIR"/* 2>/dev/null || true)

# Create config directory
mkdir -p ~/.config/ori
if [ ! -f ~/.config/ori/config.yaml ]; then
    cp testdata/config.yaml ~/.config/ori/config.example.yaml
    echo "Example config copied to ~/.config/ori/config.example.yaml"
fi

add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file"; then
        :
    elif [[ -w $config_file ]]; then
        echo -e "\n# ori" >>"$config_file"
        echo "$command" >>"$config_file"
        path_updated=true
        path_updated_file="$config_file"
        path_update_command="$command"
    else
        print_message warning "Manually add the directory to $config_file (or similar):"
        print_message info "  $command"
    fi
}

XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}

current_shell=$(basename "$SHELL")
case $current_shell in
fish)
    config_files="$HOME/.config/fish/config.fish"
    ;;
zsh)
    config_files="${ZDOTDIR:-$HOME}/.zshrc ${ZDOTDIR:-$HOME}/.zshenv $XDG_CONFIG_HOME/zsh/.zshrc $XDG_CONFIG_HOME/zsh/.zshenv"
    ;;
bash)
    config_files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile"
    ;;
ash)
    config_files="$HOME/.ashrc $HOME/.profile /etc/profile"
    ;;
sh)
    config_files="$HOME/.ashrc $HOME/.profile /etc/profile"
    ;;
*)
    # Default case if none of the above matches
    config_files="$HOME/.bashrc $HOME/.bash_profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile"
    ;;
esac

if [[ "$no_modify_path" != "true" ]]; then
    config_file=""
    for file in $config_files; do
        if [[ -f $file ]]; then
            config_file=$file
            break
        fi
    done

    if [[ -z $config_file ]]; then
        print_message warning "No config file found for $current_shell. You may need to manually add to PATH:"
        print_message info "  export PATH=$INSTALL_DIR:\$PATH"
    elif [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        case $current_shell in
        fish)
            add_to_path "$config_file" "fish_add_path $INSTALL_DIR"
            ;;
        zsh)
            add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH"
            ;;
        bash)
            add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH"
            ;;
        ash)
            add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH"
            ;;
        sh)
            add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH"
            ;;
        *)
            export PATH=$INSTALL_DIR:$PATH
            print_message warning "Manually add the directory to $config_file (or similar):"
            print_message info "  export PATH=$INSTALL_DIR:\$PATH"
            ;;
        esac
    fi
fi

echo -e ""
echo -e "✓ Installation complete!"
echo -e ""
echo -e "Installed in: ${INSTALL_ROOT}"

if [[ "$path_updated" == "true" ]]; then
    echo -e ""
    echo -e "Updated shell config: $path_updated_file"
    echo -e "Run this in the current shell to use ori immediately:"
    echo -e "  $path_update_command"
fi

echo -e ""
echo -e "ori can connect to external resources configured in ~/.config/ori/config.example.yaml"
echo -e "To uninstall:"
echo -e "  ./scripts/uninstall.sh"
echo -e ""
