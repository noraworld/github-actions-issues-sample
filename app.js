'use strict'

const { Octokit } = require('@octokit/rest')
const fs = require('fs')
const { execSync } = require('child_process')
const path = require('path')
const { DateTime } = require('luxon')
// When "\n" is used, GitHub will warn you of the following:
// We’ve detected the file has mixed line endings. When you commit changes we will normalize them to Windows-style (CRLF).
const newline = '\r\n'

async function run() {
  let comments = await getComments()
  let modes = process.env.MODE.split(',').map((element) => element.trim())

  for (const mode of modes) {
    switch (mode) {
      case 'file':
        let with_quote = (process.env.WITH_QUOTE.includes('file')) ? true : false
        let issueBody = buildIssueBody(with_quote)
        let content = buildContent(comments, issueBody)
        commit(issueBody, content)
        break
      case 'issue':
        let with_quote = (process.env.WITH_QUOTE.includes('issue')) ? true : false
        let issueBody = buildIssueBody(with_quote)
        let content = buildContent(comments, issueBody)
        post(issueBody, content)
        break
      default:
        console.error(`unknown mode: ${process.env.MODE}`)
        process.exit(1)
        break
    }
  }
}

async function getComments() {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

  const repository = process.env.GITHUB_REPOSITORY
  const [ owner, repo ] = repository.split('/')
  const issueNumber = process.env.ISSUE_NUMBER

  let comments = []
  let page = 1
  const perPage = 100
  let response = null

  do {
    response = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      page,
      per_page: perPage
    })

    comments = comments.concat(response.data)
    page++
  } while (response.data.length === perPage)

  return comments
}

function buildIssueBody(with_quote) {
  let issueBody = ''
  if (process.env.ISSUE_BODY) issueBody =  `${process.env.ISSUE_BODY}`
  if (with_quote)             issueBody =  encompassWithQuote(issueBody)
  if (process.env.ISSUE_BODY) issueBody += newline
  if (process.env.WITH_DATE)  issueBody += `${newline}> ${formattedDateTime(process.env.ISSUE_CREATED_AT)}${newline}`
  return issueBody
}

function buildContent(comments, issueBody, with_quote) {
  let content = ''
  let isFirstComment = true

  comments.forEach((comment) => {
    if (!isFirstComment || issueBody) {
      content += with_quote ? `${newline}>---${newline}>${newline}` : `${newline}---${newline}${newline}`
    }
    isFirstComment = false

    content += with_quote ? encompassWithQuote(comment.body) : comment.body

    if (process.env.WITH_DATE) {
      content += `${newline}${newline}> ${formattedDateTime(comment.created_at)}`
    }

    content += `${newline}`
  })

  return content
}

function commit(issueBody, content) {
  const filepath = process.env.FILEPATH

  let existingContent = ''
  let commitMessage = ''
  if (fs.existsSync(filepath)) {
    existingContent = `${fs.readFileSync(filepath)}${newline}${process.env.EXTRA_TEXT_WHEN_MODIFIED}${newline}`
    commitMessage = `Update ${path.basename(filepath)}`
  }
  else {
    commitMessage = `Add ${path.basename(filepath)}`
  }

  let header = ''
  if (!existingContent && process.env.WITH_HEADER) {
    header = `${process.env.WITH_HEADER}${newline}${newline}`
  }

  const dir = path.dirname(filepath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(filepath, `${header}${existingContent}${issueBody}${content}`)

  execSync(`git config --global user.name "${process.env.COMMITTER_NAME}"`)
  execSync(`git config --global user.email "${process.env.COMMITTER_EMAIL}"`)
  execSync(`git add "${filepath}"`)
  execSync(`git commit -m "${commitMessage}"`)
  execSync('git push')
}

function post(issueBody, content) {
  let targetIssueRepo = process.env.TARGET_ISSUE_REPO ? process.env.ISSUE_REPO : process.env.GITHUB_REPOSITORY

  let targetIssueNumber = ''
  if (process.env.TARGET_ISSUE_NUMBER && process.env.TARGET_ISSUE_NUMBER !== 'latest') {
    targetIssueNumber = process.env.TARGET_ISSUE_NUMBER
  }
  else {
    targetIssueNumber = execSync(`gh issue list --repo "${targetIssueRepo}" --limit 1 | awk '{ print $1 }'`).toString().trim()
  }

  let header = ''
  if (process.env.WITH_HEADER) header = `${process.env.WITH_HEADER}${newline}${newline}`

  let title = `# ✅ [${process.env.ISSUE_TITLE}](${process.env.ISSUE_URL})${newline}`

  execSync(`gh issue comment --repo "${targetIssueRepo}" "${targetIssueNumber}" --body "${header}${title}${issueBody}${content}"`)
}

function formattedDateTime(timestamp) {
  const universalTime = DateTime.fromISO(timestamp, { zone: 'utc' })
  const localTime = universalTime.setZone(process.env.TIMEZONE)
  return localTime.toFormat(process.env.TIME_FORMAT)
}

function encompassWithQuote(str) {
  return `>${str.replaceAll(/\r\n/g, '$&>')}`
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
