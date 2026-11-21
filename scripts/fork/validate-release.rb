#!/usr/bin/env ruby
require "base64"
require "digest"
require "yaml"

version, root = ARGV
abort "Usage: validate-release.rb <nightly-version> <artifact-root>" unless
  ARGV.size == 2 && version.match?(/\A\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\z/)

mac = "T3-Code-#{version}-arm64"
win = "T3-Code-#{version}-x64"
platforms = {
  "mac" => ["nightly-mac.yml", ["#{mac}.zip", "#{mac}.dmg"]],
  "win" => ["nightly.yml", ["#{win}.exe"]]
}

assets = []
platforms.each do |platform, (manifest, filenames)|
  directory = File.join(root, "fork-desktop-#{platform}")
  manifest_path = File.join(directory, manifest)
  metadata = YAML.safe_load(File.read(manifest_path), permitted_classes: [Time])
  abort "#{manifest} expected version #{version}" unless metadata.fetch("version") == version
  files = metadata.fetch("files")
  abort "#{manifest} expected file names #{filenames.join(', ')}" unless
    files.map { |file| file.fetch("url") }.sort == filenames.sort

  primary = files.find { |file| file.fetch("url") == metadata.fetch("path") }
  abort "#{manifest} has inconsistent primary asset information" unless
    primary && primary.fetch("url") == filenames.first && metadata.fetch("sha512") == primary.fetch("sha512")

  assets << manifest_path
  files.each do |file|
    path = File.join(directory, file.fetch("url"))
    digest = Base64.strict_encode64(Digest::SHA512.file(path).digest)
    abort "#{manifest} has a SHA-512 mismatch for #{file.fetch("url")}" unless digest == file.fetch("sha512")
    abort "#{manifest} has a size mismatch for #{file.fetch("url")}" unless File.size(path) == file.fetch("size")
    blockmap = "#{path}.blockmap"
    abort "Missing or empty blockmap for #{file.fetch("url")}" unless File.file?(blockmap) && File.size?(blockmap)
    assets.push(path, blockmap)
  end
end

puts assets
