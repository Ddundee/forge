class Forge < Formula
  desc "Idea to product in one command"
  homepage "https://github.com/Ddundee/forge"
  url "https://github.com/Ddundee/forge/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "d78d617fa0a12ec5523b840e3d54fb4a1832c909705e293eaa1a2dbacd592cef"
  license "MIT"

  depends_on "python@3.11"

  def install
    python = Formula["python@3.11"].opt_bin/"python3.11"
    venv = libexec/"venv"
    system python, "-m", "venv", venv
    system venv/"bin/pip", "install", "--upgrade", "pip", "--quiet"
    system venv/"bin/pip", "install", "--no-cache-dir", buildpath, "--quiet"
    bin.install_symlink venv/"bin/forge"
  end

  test do
    assert_match "Idea to product", shell_output("#{bin}/forge --help")
  end
end
