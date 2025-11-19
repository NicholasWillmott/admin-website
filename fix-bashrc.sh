#!/bin/bash

# Fix the broken .bashrc on the droplet

echo "Fixing .bashrc..."

# Remove all Deno-related lines from .bashrc
sed -i '/DENO_INSTALL/d' ~/.bashrc
sed -i '/\.deno\/env/d' ~/.bashrc

# Add clean Deno configuration once
echo 'export DENO_INSTALL="$HOME/.deno"' >> ~/.bashrc
echo 'export PATH="$DENO_INSTALL/bin:$PATH"' >> ~/.bashrc

# Reload
source ~/.bashrc

echo "✓ Fixed! Testing Deno..."
deno --version

echo ""
echo "If Deno version shows above, you're good to go!"
