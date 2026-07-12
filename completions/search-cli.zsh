# search-cli zsh completion
# Source: source <(search-cli --completion zsh)

_search_cli() {
  local -a opts
  opts=(
    '--json[JSON output]'
    '--csv[CSV output]'
    '--markdown[Markdown table output]'
    '--count[Only result count]'
    '--limit[Max results]:limit:'
    '--sort[Sort strategy]:(best-match stars updated forks)'
    '--token[GitHub token]:token:'
    '--trending[Trending mode]'
    '--since[Trending period]:(daily weekly monthly)'
    '--pipe[Pipe target]:(clone open)'
    '--format[Output format]:(urls names ssh-urls clone-commands ids)'
    '--watch[Watch mode]'
    '--interval[Watch interval seconds]:seconds:'
    '--version[Print version]'
    '--help[Print help]'
    '--completion[Shell]:(bash zsh fish)'
  )
  _arguments "${opts[@]}" '*:query:'
}

compdef _search_cli search-cli
