# Builds the Workspace image on top of Vercel's Ubuntu Sandbox image, which is
# itself built here from Vercel's open Dockerfiles: the managed
# `vcr.vercel.com/vercel/sandbox/universal` can't be pulled as a base outside a
# Sandbox. The workflow checks out github.com/vercel/sandbox into
# VERCEL_BASE_DOCKERFILES first.
#
#   docker buildx bake -f apps/app/vercel-sandbox-image/docker-bake.hcl workspace

variable "VERCEL_BASE_DOCKERFILES" {
  default = "vercel-sandbox/images"
}

# Space-separated image references to tag (and push) the Workspace image as.
variable "TAGS" {
  default = "screenplay-workspace:local"
}

variable "PUSH" {
  default = false
}

target "_common" {
  platforms = ["linux/amd64"]
  attest    = ["type=provenance,disabled=true", "type=sbom,disabled=true"]
}

target "vercel-ubuntu" {
  inherits = ["_common"]
  context  = "${VERCEL_BASE_DOCKERFILES}/ubuntu"
}

target "vercel-universal" {
  inherits = ["_common"]
  context  = "${VERCEL_BASE_DOCKERFILES}/universal"
  contexts = {
    base = "target:vercel-ubuntu"
  }
}

target "workspace" {
  inherits = ["_common"]
  context  = "apps/app/vercel-sandbox-image"
  contexts = {
    vercel-universal = "target:vercel-universal"
  }
  args = {
    BASE_IMAGE = "vercel-universal"
  }
  tags   = split(" ", TAGS)
  output = ["type=image,push=${PUSH},oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true"]
}
