# ghfind bash completion
# Source: source <(ghfind --completion bash)

_ghfind() {
  local cur prev opts
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  opts="--json --csv --markdown --count --limit --sort --token --trending --language --since --pipe --format --registry --watch --interval --version --help --completion --remote --local --copy --raw --as pkg login init doctor org user mcp skill bookmarks history topics saved readme share trending deep-dive compare"

  case "${prev}" in
    --sort)
      COMPREPLY=( $(compgen -W "best-match stars updated forks" -- "${cur}") )
      return 0
      ;;
    --since)
      COMPREPLY=( $(compgen -W "daily weekly monthly" -- "${cur}") )
      return 0
      ;;
    --pipe)
      COMPREPLY=( $(compgen -W "clone open" -- "${cur}") )
      return 0
      ;;
    --format)
      COMPREPLY=( $(compgen -W "urls names ssh-urls clone-commands ids" -- "${cur}") )
      return 0
      ;;
    --completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "${cur}") )
      return 0
      ;;
    --as)
      COMPREPLY=( $(compgen -W "markdown plain gh-cli short" -- "${cur}") )
      return 0
      ;;
    --registry)
      COMPREPLY=( $(compgen -W "npm" -- "${cur}") )
      return 0
      ;;
    --language)
      COMPREPLY=( $(compgen -W "rust python typescript javascript go c c++ c# java ruby php swift kotlin zig" -- "${cur}") )
      return 0
      ;;
    --limit|--interval)
      return 0
      ;;
    *)
      ;;
  esac

  COMPREPLY=( $(compgen -W "${opts}" -- "${cur}") )
  return 0
}
complete -F _ghfind ghfind
