# search-cli bash completion
# Source: source <(search-cli --completion bash)

_search_cli() {
  local cur prev opts
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  opts="--json --csv --markdown --count --limit --sort --token --trending --since --pipe --format --watch --interval --version --help --completion"

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
    --limit|--interval)
      return 0
      ;;
    *)
      ;;
  esac

  COMPREPLY=( $(compgen -W "${opts}" -- "${cur}") )
  return 0
}
complete -F _search_cli search-cli
