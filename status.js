/*
 * Utility for checking the various dependencies of https://teia.art
 */

const axios = require('axios')
const axiosRetry = require('axios-retry')

// Need NFT_STORAGE_KEY env variable
require('dotenv').config()

const {
  Octokit
} = require("@octokit/rest")

// Need GITHUB_TOKEN env variable
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: 'teia status',
})

const GRAPHQL_ENDPOINT = 'https://api.teia.rocks/v1/graphql'
const TEZOS_ADDRESS_REGEX = `^(tz1|tz2|tz3|KT1)[0-9a-zA-Z]{33}$`

const BLOCKCHAIN_LEVEL_DIFF = 50 // arbitrary blockchain level comparison


axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => {
    console.log('retryDelay', retryCount)
    return retryCount * 5000
  },
  retryCondition: (error) => {
    if (error && error.response) {
      console.log('retryCondition', error.response.status, error.config.url)
      return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response.status === 429
    }
    return axiosRetry.isNetworkOrIdempotentRequestError(error)
  }
})

const logAxiosError = (error) => {
  try {
    if (error) {
      if (error.response && error.response.statusText) {
        console.error(error.response.status, error.response.statusText, error.config.url)
      } else if (error.isAxiosError) {
        console.error(error.message)
      } else {
        console.error(error)
      }
    }
  } catch (err) {
    console.error(error)
  }
}

const downloadList = async (url) => {
  try {
    let res = await axios.get(url)
    return res.data
  } catch (error) {
    console.error(error)
  }
  return null
}

const validTezosAccount = (account) => {
  const match = account.trim().match(TEZOS_ADDRESS_REGEX)
  if (match) {
    return match.length > 0
  } else {
    return false
  }
}

const getDipdupHead = `query {
  dipdup_head {
    created_at
    hash
    level
    name
    timestamp
    updated_at
  }
}`

const getDipdupHeadStatus = `query {
  dipdup_head_status {
    name
    status
  }
}`

const OBJKT_TOKEN_QUERY = `query getTokenAsks($tokenId: String!, $fa2: String!) {
  token(where: {token_id: {_eq: $tokenId}, fa_contract: {_eq: $fa2}}) {
    creators {
      creator_address
    }
    royalties {
      receiver_address
      amount
      decimals
    }
    listings(order_by: {price: asc}, where: {price: {_gt: 0}, _or: [{status: {_eq: "active"}, currency_id: {_eq: 1}, seller: {owner_operators: {token: {fa_contract: {_eq: $fa2}, token_id: {_eq: $tokenId}}, allowed: {_eq: true}}, held_tokens: {quantity: {_gt: "0"}, token: {fa_contract: {_eq: $fa2}, token_id: {_eq: $tokenId}}}}}, {status: {_eq: "active"}}]}) {
      id
      amount
      amount_left
      price
      seller_address
      shares
      seller {
        alias
        address
      }
    }
  }
}`

const TEZTOK_LEVEL_QUERY = `query MyQuery {
  events_aggregate {
    aggregate {
      max {
        level
      }
    }
  }
}`

const TEZTOK_MEDIASTATUS_QUERY = `query MyQuery {
  tokens(order_by: {minted_at: desc}, limit: 20) {
    metadata_status
  }
}`

const fetchGraphQL = async (operationsDoc, operationName, variables, endpoint) => {
  let result = null
  try {
    const response = await axios.post(endpoint ? endpoint : GRAPHQL_ENDPOINT, {
      query: operationsDoc,
      variables: variables,
      operationName: operationName,
    })

    if (response.data.errors) {
      console.error(response.data.errors)
      result = null
    } else {
      result = response.data
    }
  } catch (error) {
    if (error.response && error.response.statusText) {
      console.error(error.response.status, error.response.statusText, error.config.url)
    } else {
      console.error('error', 'fetchGraphQL', operationName)
    }
  }

  if (result) {
    return result
  }
  return {
    errors: 'fetchGraphQL failed'
  }
}

const TZKT_API_ONLINE = 'TzKT API is online.'
const TZKT_API_DOWN = '**TzKT API is down.**'

let tzktApiHead = null
let tzktApiStatusMessage = TZKT_API_ONLINE
const checkTzktStatus = async () => {
  try {
    const tzktResponse = await axios.get('https://api.tzkt.io/v1/head')
    if (!tzktResponse) {
      tzktApiStatusMessage = TZKT_API_DOWN
      return
    }
    tzktApiHead = tzktResponse.data
    const apiResponse = await axios({
      method: 'get',
      url: 'https://api.tzkt.io/v1/accounts/tz1XtjZTzEM6EQ3TnUPUQviCD6WfcsZRHXbj/operations?sort=0&limit=2',
      timeout: 10000
    })
    if (!apiResponse) {
      tzktApiStatusMessage = TZKT_API_DOWN
      return
    }
    tzktApiStatusMessage = TZKT_API_ONLINE
  } catch (error) {
    if (error) {
      if (error.response && error.response.statusText) {
        console.error('checkTzktStatus', error.response.status, error.response.statusText, error.config.url)
      } else if (error.isAxiosError) {
        console.error('checkTzktStatus', error.message)
      } else {
        console.error('checkTzktStatus', error)
      }
    }
    tzktApiStatusMessage = TZKT_API_DOWN
  }
}

const TEIA_INDEXER_UP_TO_DATE = `Teia indexer is up to date.`
const TEIA_INDEXER_ERROR = '**Teia indexer is experiencing technical difficulties.**'
let indexerStatusMessage = TEIA_INDEXER_UP_TO_DATE

const checkIndexerStatus = async () => {
  if (tzktApiHead) {
    try {
      if (tzktApiHead.knownLevel - tzktApiHead.level > 10) {
        indexerStatusMessage = `Teia indexer problem: TzKT API has fallen behind the blockchain updates.`
        return
      }

      const dipdupHeadStatus = await fetchGraphQL(getDipdupHeadStatus)
      const tzktNode = dipdupHeadStatus.data.dipdup_head_status.find(({ status }) => status === 'OK')

      if (!tzktNode) {
        indexerStatusMessage = '**Cannot determine the Teia indexer head status.**'
        return
      }

      const dipdupState = await fetchGraphQL(getDipdupHead)
      const mainnetNode = dipdupState.data.dipdup_head.find(({ name }) => name === tzktNode.name)

      if (!mainnetNode) {
        indexerStatusMessage = TEIA_INDEXER_ERROR
        return
      }

      if (tzktApiHead && mainnetNode) {
        const delta = Math.abs(tzktApiHead.level - mainnetNode.level)

        if (delta > BLOCKCHAIN_LEVEL_DIFF) {
          indexerStatusMessage = `**Teia indexer is currently delayed by ${delta} blocks. During this period, operations (mint, collect, swap) are prone to fail.**`
        } else {
          indexerStatusMessage = TEIA_INDEXER_UP_TO_DATE
        }
      } else {
        indexerStatusMessage = TEIA_INDEXER_ERROR
      }
    } catch (error) {
      console.error(error)
      indexerStatusMessage = TEIA_INDEXER_ERROR
    }
  }
}

const fetchJSON = async (url) => {
  try {
    const response = await axios({
      method: 'get',
      url,
      timeout: 1000 * 60 * 2
    })
    return response.data
  } catch (error) {
    logAxiosError(error)
  }
  return null
}

const TEIA_TZKT_SERVER_UP_TO_DATE = `Teia TzKT server is up to date.`
const TEAI_TZKT_SERVER_ERROR = '**Teia TzKT server is experiencing technical difficulties.**'
let teiaTzktStatusMessage = TEIA_TZKT_SERVER_UP_TO_DATE

const checkTeiaTzktIndexerStatus = async () => {
  if (tzktApiHead) {
    try {
      const teztokHead = await fetchJSON(
        `https://tzkt.teia.rocks/v1/head`
      )

      if (tzktApiHead && teztokHead) {
        const delta = Math.abs(tzktApiHead.level - teztokHead.level)

        if (delta > BLOCKCHAIN_LEVEL_DIFF) {
          teiaTzktStatusMessage = `**Teia TzKT server is currently delayed by ${delta} blocks. During this period, operations (mint, collect, swap) are prone to fail.**`
        } else {
          teiaTzktStatusMessage = TEIA_TZKT_SERVER_UP_TO_DATE
        }
      } else {
        teiaTzktStatusMessage = TEAI_TZKT_SERVER_ERROR
      }
    } catch (error) {
      console.error(error)
      teiaTzktStatusMessage = TEAI_TZKT_SERVER_ERROR
    }
  }
}

const TEZTOK_ONLINE = `TezTok indexer is online.`
const TEZTOK_ERROR = '**TezTok indexer is experiencing technical difficulties.**'
const TEZTOK_GRAPHQL_SERVER = 'https://teztok.teia.rocks/v1/graphql'
let teztokIndexerStatusMessage = TEZTOK_ONLINE

const checkTeztokIndexerStatus = async () => {
  try {
    const response = await fetchGraphQL(TEZTOK_LEVEL_QUERY, 'MyQuery', {}, TEZTOK_GRAPHQL_SERVER)
    if (response && response.data && response.data.events_aggregate) {
      teztokIndexerStatusMessage = TEZTOK_ONLINE
      if (tzktApiHead) {
        const delta = Math.abs(tzktApiHead.level - response.data.events_aggregate.aggregate.max.level)

        if (delta > BLOCKCHAIN_LEVEL_DIFF) {
          teztokIndexerStatusMessage = `**TezTok indexer is currently delayed by ${delta} blocks. During this period, operations (mint, collect, swap) are prone to fail.**`
        } else {
          teztokIndexerStatusMessage = `TezTok indexer is up to date.`
          const mediaSTatusResponse = await fetchGraphQL(TEZTOK_MEDIASTATUS_QUERY, 'MyQuery', {}, TEZTOK_GRAPHQL_SERVER)
          if (mediaSTatusResponse && mediaSTatusResponse.data && mediaSTatusResponse.data.tokens) {
            let errors = 0
            for (let index = 0; index < mediaSTatusResponse.data.tokens.length; index++) {
              const token = mediaSTatusResponse.data.tokens[index]
              if (token.metadata_status === 'error' || token.metadata_status === 'unprocessed') {
                errors++
              }
            }
            if (errors >= 10) {
              teztokIndexerStatusMessage = `**TezTok indexer metadata processing errors.**`
            }
          }
        }
      } else {
        teztokIndexerStatusMessage = TEZTOK_ERROR
      }
    } else {
      teztokIndexerStatusMessage = `**TezTok indexer is offline.**`
    }
  } catch (error) {
    console.error(error)
    teztokIndexerStatusMessage = TEZTOK_ERROR
  }
}

const OBJKT_INDEXER_ONLINE = `Objkt.com indexer is online.`
let objkIndexerStatusMessage = OBJKT_INDEXER_ONLINE

const checkObjktIndexerStatus = async () => {
  try {
    const response = await fetchGraphQL(OBJKT_TOKEN_QUERY, 'getTokenAsks', { tokenId: '768380', fa2: 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton' }, 'https://data.objkt.com/v3/graphql')
    if (response && response.data && response.data.token) {
      objkIndexerStatusMessage = OBJKT_INDEXER_ONLINE
    } else {
      objkIndexerStatusMessage = `**Objkt.com indexer is offline.**`
    }
  } catch (error) {
    console.error(error)
    objkIndexerStatusMessage = '**Objkt.com indexer is experiencing technical difficulties.**'
  }
}

const IPFS_GATEWAY_RESPONSIVE = `IPFS gateway (nftstorage.link) is responsive.`
let ipfsGatewayImageMessage = IPFS_GATEWAY_RESPONSIVE
const checkIpfsGateway = async () => {
  // We check if the gateway is up by loading 1x1 px image
  // Same as: https://ipfs.github.io/public-gateway-checker/
  try {
    const start = Date.now()

    const url = 'https://nftstorage.link/ipfs/bafybeibwzifw52ttrkqlikfzext5akxu7lz4xiwjgwzmqcpdzmp3n5vnbe'
    await new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout when attempting to load '${url}`))
      }, 15000)
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
        })
        const buffer = Buffer.from(response.data, 'base64')
        clearTimeout(timer)
        if (buffer) {
          resolve()
        } else {
          reject(new Error(`Could not download '${url}`))
        }
      } catch (error) {
        clearTimeout(timer)

        if (error == null) {
          reject(new Error(`Unknown error when attempting to load '${url}`))
        } else {
          reject(error)
        }
      }
    })
    const millis = Date.now() - start
    if (millis < 5000) {
      ipfsGatewayImageMessage = IPFS_GATEWAY_RESPONSIVE
      return true
    } else {
      ipfsGatewayImageMessage = `**IPFS gateway (nftstorage.link) is slow.**`
      return false
    }
  } catch (error) {
    console.error(error.message)
    ipfsGatewayImageMessage = '**IPFS gateway (nftstorage.link) is experiencing technical difficulties.**'
  }
  return false
}

const TEIA_ONLINE = 'Teia.art is online.'
let teiaStatusMessage = TEIA_ONLINE

const TEIA_COMMIT_LATEST = 'Teia.art has the latest GitHub commit.'
let teiaCommitStatusMessage = TEIA_COMMIT_LATEST
let commitUpToDate = true

const checkGui = async () => {
  try {
    let res = await axios.get('https://teia.art')
    const data = res.data
    if (data.indexOf('<head>') != -1) {
      teiaStatusMessage = TEIA_ONLINE
    }
    let found = false
    let sha
    const result = await axios.head('https://teia.art')
    if (result.status === 200) {
      sha = result.headers['x-teia-commit-hash']
    }
    if (!sha) {
      const regex = /<meta name="build-commit" content="([a-z0-9]*)"/i
      found = data.match(regex)
      if (found.length > 1) {
        sha = found[1]
      }
    }

    if (sha) {
      const res = await octokit.request(`GET https://api.github.com/repos/teia-community/teia-ui/commits/main`, {})
      if (res && res.data.sha === sha) {
        teiaCommitStatusMessage = TEIA_COMMIT_LATEST
      } else {
        teiaCommitStatusMessage = '**Teia.art is behind the latest GitHub commit.**'
      }
    }
  } catch (error) {
    console.error(error)
    teiaStatusMessage = '**Teia.art is offline.**'
  }
}

let nftStorageStatus = 'NFT.Storage is operational.'
const checkNftStorage = async () => {
  try {
    let res = await axios.get('https://status.nft.storage/')
    const data = res.data
    const regexIncident = /unresolved-incidents/i
    const foundIncident = data.match(regexIncident)
    if (foundIncident && foundIncident.length >= 1) {
      nftStorageStatus = `**NFT.Storage is experiencing an incident.**`
      return
    } else {
      const regexStatus = /data-component-status="([a-z_]*)"/i
      const foundStatus = data.match(regexStatus)
      if (foundStatus && foundStatus.length > 1) {
        if (foundStatus[1] === 'operational') {
          nftStorageStatus = `NFT.Storage is operational.`
        } else {
          nftStorageStatus = `**NFT.Storage is experiencing an outage.**`
          return
        }
      } else {
        nftStorageStatus = `**NFT.Storage status is unknown.**`
        return
      }
    }
  } catch (error) {
    console.error(error)
    nftStorageStatus = `**NFT.Storage status is unknown.**`
    return
  }
  try {
    let result = await axios({
      method: 'get',
      url: 'https://api.nft.storage/bafkreidivzimqfqtoqxkrpge6bjyhlvxqs3rhe73owtmdulaxr5do5in7u',
      headers: { 'Authorization': 'Bearer ' + process.env.NFT_STORAGE_KEY }
    })
    if (result.data.ok) {
      nftStorageStatus = `NFT.Storage is operational.`
    } else {
      nftStorageStatus = `**NFT.Storage is experiencing an outage.**`
    }
  } catch (error) {
    logAxiosError(error)
    nftStorageStatus = `**NFT.Storage is experiencing an outage.**`
  }
}

let latestObjtId = 701552

const LATEST_ID_QUERY = `
  query LatestFeed {
    token(order_by: {id: desc}, limit: 1, where: {artifact_uri: {_neq: ""}}) {
      id
    }
  }`

const getLastestId = async () => {
  try {
    let response = await fetchGraphQL(LATEST_ID_QUERY, 'LatestFeed', {})
    latestObjtId = parseInt(response.data.token[0].id)
  } catch (error) {
    console.error(error)
  }
  return latestObjtId
}

let swapHistoryCount = 0

const SWAP_HISTORY_QUERY = `
  query swapHistory($timestamp: timestamptz!) {
    swap(where: {contract_address: {_eq: "KT1PHubm9HtyQEJ4BBpMTVomq6mhbfNZ9z5w"}, timestamp: {_gte: $timestamp}}) {
      token_id
    }
  }`

const getSwapHistory = async () => {
  try {
    var date = new Date()
    date.setDate(date.getDate() - 1)
    const timestamp = date.toISOString().slice(0, -5) + '+00:00'
    let response = await fetchGraphQL(SWAP_HISTORY_QUERY, 'swapHistory', { timestamp })
    swapHistoryCount = response.data.swap.length
  } catch (error) {
    console.error(error)
  }
  return swapHistoryCount
}

let mintHistoryCount = 0

const MINT_HISTORY_QUERY = `
  query mintHistory($timestamp: timestamptz!) {
    token(where: {artifact_uri: {_neq: ""}, timestamp: {_gte: $timestamp}}) {
      id
    }
  }`

const getMintHistory = async () => {
  try {
    var date = new Date()
    date.setDate(date.getDate() - 1)
    const timestamp = date.toISOString().slice(0, -5) + '+00:00'
    let response = await fetchGraphQL(MINT_HISTORY_QUERY, 'mintHistory', { timestamp })
    mintHistoryCount = response.data.token.length
  } catch (error) {
    console.error(error)
  }
  return mintHistoryCount
}

let tzProfilesMessage = 'TzProfiles is online.'

const DIPDUP_HEAD = `{
  dipdup_head {
    name
    level
    timestamp
  }
}`

const checkTzProfiles = async () => {
  try {
    const dipdupState = await fetchGraphQL(DIPDUP_HEAD, null, null, 'https://indexer.tzprofiles.com/v1/graphql')
    const timestamp = Date.parse(dipdupState.data.dipdup_head[0].timestamp)
    const now = new Date()
    const diffTime = Math.abs(now - timestamp)
    const diffMins = Math.ceil(diffTime / (1000 * 60))
    let diffLevel = 0
    if (tzktApiHead) {
      diffLevel = tzktApiHead.knownLevel - dipdupState.data.dipdup_head[0].level
    }
    if (diffMins > 10 || diffLevel > 5) {
      tzProfilesMessage = '**TzProfiles indexer has fallen behind the blockchain updates.**'
      return
    }

    let res = await axios.get('https://api.tzprofiles.com/tz1XtjZTzEM6EQ3TnUPUQviCD6WfcsZRHXbj')
    if (res.data.length > 0) {
      tzProfilesMessage = 'TzProfiles is online.'
    } else {
      tzProfilesMessage = '**TzProfiles is down.**'
    }
  } catch (error) {
    if (error.response && error.response.statusText) {
      console.error(error.response.status, error.response.statusText, error.config.url)
    } else {
      console.error('error', 'checkTzProfiles')
    }
    tzProfilesMessage = '**TzProfiles is down.**'
  }
  return tzProfilesMessage
}

const MEMPOOL_QUERY = `{
  transactions(where: {destination: {_eq: "KT1PHubm9HtyQEJ4BBpMTVomq6mhbfNZ9z5w"}, status: {_neq: "in_chain"}, network: {_eq: "mainnet"}}, limit: 100, order_by: {created_at: desc}) {
    amount
    target: destination
    parameter: parameters
    branch
    created_at
    errors
    hash
    type: kind
    signature
    status
    counter
    bakerFee: fee
    gasLimit: gas_limit
    sender: source
    storageLimit: storage_limit
  }
}`

const MEMPOOL_MESSAGE_NOMINAL = 'Nominal number of transactions in the blockchain mempool.'
let mempoolMessage = MEMPOOL_MESSAGE_NOMINAL

const checkMempool = async () => {
  // https://dipdup.net/sandbox.html?service=mempool
  try {
    const mempoolList = await fetchGraphQL(MEMPOOL_QUERY, null, null, 'https://mempool.dipdup.net/v1/graphql')
    const transactions = mempoolList.data.transactions
    if (transactions.length > 10) {
      mempoolMessage = '**High number of transactions in the blockchain mempool.**'
      return mempoolMessage
    }
    mempoolMessage = MEMPOOL_MESSAGE_NOMINAL
  } catch (error) {
    console.error(error)
    mempoolMessage = '**Mempool status cannot be quieried.**'
  }
  return mempoolMessage
}

const RESTRICTED_LIST_WELL_FORMATTED = 'Restricted list is well-formatted.'
let restrictedListMessage = RESTRICTED_LIST_WELL_FORMATTED

const checkRestrictedList = async () => {
  try {
    let restrictedList = await downloadList(
      'https://raw.githubusercontent.com/teia-community/teia-report/main/restricted.json'
    )

    if (restrictedList) {
      if (!Array.isArray(restrictedList)) {
        restrictedListMessage = '**Restricted list is not formatted correctly.**'
      } else {
        for (let index = 0; index < restrictedList.length; index++) {
          const address = restrictedList[index]
          if (!validTezosAccount(address)) {
            restrictedListMessage = `**Restricted list contains an invalid address: ${address}.**`
            return
          }
        }
        restrictedListMessage = RESTRICTED_LIST_WELL_FORMATTED
      }
    }
  } catch (error) {
    console.error(error)
    restrictedListMessage = '**Restricted list could not be retrieved.**'
  }
}

let rpcNodes = []
let checkingRpc = false
const CANNOT_DETERMINE_RPC_RESULTS = '**Cannot determine RPC nodes status**'
let rpcNodesMessage = CANNOT_DETERMINE_RPC_RESULTS
// List from: https://github.com/versumstudios/rpc-health/blob/main/cron/rpc.js
const checkRpcNodes = async () => {
  if (checkingRpc) {
    return
  }
  checkingRpc = true
  const RPC_NODES = [
    'mainnet.api.tez.ie',
    'mainnet.smartpy.io',
    'rpc.tzbeta.net',
    'mainnet.tezos.marigold.dev',
    'rpc.tzkt.io/mainnet',
    'mainnet.teia.rocks',
    //'eu01-node.teztools.net'
  ]
  try {
    if (tzktApiHead) {
      rpcNodes = []
      for (let index = 0; index < RPC_NODES.length; index++) {
        const node = RPC_NODES[index]
        let level = -1
        let time = 0
        const before = Date.now()

        await axios
          .get(`https://${node}/chains/main/blocks/head/header`, { timeout: 10000 })
          .then((response) => {
            const data = response.data
            level = Math.abs(tzktApiHead.level - data.level)
            time = Date.now() - before

            const found = rpcNodes.find((e) => e.node === node)
            if (found) {
              found.level = level
              found.time = time
            } else {
              rpcNodes.push({ level, time, node, status: response.status })
            }
          })
          .catch((error) => {
            console.error('error', node)
            if (error.response) {
              console.error(error.response.data)
              console.error(error.response.status)
              console.error(error.response.headers)
            } else {
              console.error(error)
            }
            rpcNodes.push({ node, error: true })
          })
      }
      rpcNodesMessage = `RPC nodes status:`
      for (let index = 0; index < rpcNodes.length; index++) {
        const node = rpcNodes[index]
        if (node.error) {
          rpcNodesMessage += `\n- **${node.node}: Cannot determine status**`
        } else {
          rpcNodesMessage += `\n- ${node.node}: level=${node.level} time=${node.time}, status=${node.status === 200 ? 'OK' : node.status}`
        }
      }
    }
  } catch (error) {
    if (error.response && error.response.statusText) {
      console.error(error.response.status, error.response.statusText, error.config.url)
    } else {
      console.error('error', 'checkRpcNodes')
    }
  }
  checkingRpc = false
}

const CANNOT_DETERMINE_VOTING_RESULTS = '**Cannot determine Teia Token Distribution Voting results**'
let daoTokenDistributionVoteMessage = CANNOT_DETERMINE_VOTING_RESULTS
const POLL_ID = 'QmeJ9ATjn4ge9phDzvpmdZzRZdRoKJdyk4swPiVgaxAx6z'
const checkDaoTokenDistributionVotes = async () => {
  try {
    let teiaUsersList = await downloadList('https://cache.teia.rocks/ipfs/QmNihShvZkXq7aoSSH3Nt1VeLjgGkESr3LoCzShNyV4uzp')

    if (teiaUsersList) {
      if (!Array.isArray(teiaUsersList)) {
        daoTokenDistributionVoteMessage = '**Teia user list is not formatted correctly.**'
      } else {
        let pollInformation = await downloadList(`https://cache.teia.rocks/ipfs/${POLL_ID}`)

        if (pollInformation["multi"] == "false") {
          pollInformation["opt1"] = "YES"
          pollInformation["opt2"] = "NO"
        }

        let allVotes = await downloadList(`https://api.mainnet.tzkt.io/v1/bigmaps/64367/keys?limit=10000&key.string=${POLL_ID}`)

        let votes = []
        for (let index = 0; index < allVotes.length; index++) {
          const vote = allVotes[index]
          if (teiaUsersList.includes(vote.key.address)) {
            votes.push(vote)
          }
        }

        let results = {}
        for (let i = 1; i < 4; i++) {
          let iString = i.toString()
          results[iString] = { "name": pollInformation["opt" + iString], "votes": 0 }
        }

        for (let index = 0; index < votes.length; index++) {
          const vote = votes[index]
          results[vote["value"]]["votes"] += 1
        }

        daoTokenDistributionVoteMessage = `${votes.length} Teia users have voted so far (${allVotes.length - votes.length} votes were invalid):`

        const keys = Object.keys(results)
        for (const key of keys) {
          const entry = results[key]
          daoTokenDistributionVoteMessage += `\n- ${entry.name}: ${entry.votes} votes (${(entry.votes * 100 / votes.length).toFixed(1)}%)`
        }
      }
    }
  } catch (error) {
    console.error(error)
    daoTokenDistributionVoteMessage = CANNOT_DETERMINE_VOTING_RESULTS
  }
}

const TEIA_IPFS_GATEWAY_RESPONSIVE = `IPFS gateway (cache.teia.rocks) is responsive.`
let teiaIpfsGatewayImageMessage = TEIA_IPFS_GATEWAY_RESPONSIVE
const checkTeiaIpfsGateway = async () => {
  // We check if the Teia IPFS gateway is up by loading a text file that contains the word: "ok"
  // This url will never be cached and will always hit the ipfs gateway
  try {
    const start = Date.now()

    const url = 'https://cache.teia.rocks/ipfs/Qmf46hrJfcA8TvEMh6VNHM2G4JxsykxfYwcfhRr5ZFT12E'
    await new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout when attempting to load '${url}`))
      }, 15000)
      try {
        const response = await axios.get(url)
        clearTimeout(timer)
        if (response) {
          if (response.data.trim() === 'ok') {
            resolve()
          } else {
            reject(new Error(`Invalid content for '${url}`))
          }
        } else {
          reject(new Error(`Could not download '${url}`))
        }
      } catch (error) {
        clearTimeout(timer)

        if (error == null) {
          reject(new Error(`Unknown error when attempting to load '${url}`))
        } else {
          reject(error)
        }
      }
    })
    const millis = Date.now() - start
    if (millis < 5000) {
      teiaIpfsGatewayImageMessage = TEIA_IPFS_GATEWAY_RESPONSIVE
      return true
    } else {
      teiaIpfsGatewayImageMessage = `**IPFS gateway (cache.teia.rocks) is slow.**`
      return false
    }
  } catch (error) {
    console.error(error.message)
    teiaIpfsGatewayImageMessage = '**IPFS gateway (cache.teia.rocks) is experiencing technical difficulties.**'
  }
  return false
}

// Status text using Discord markdown formatting
const getStatus = () => {
  return `${teiaStatusMessage}
${teiaCommitStatusMessage}
${indexerStatusMessage}
${teiaTzktStatusMessage}
${teztokIndexerStatusMessage}
${objkIndexerStatusMessage}
${ipfsGatewayImageMessage}
${teiaIpfsGatewayImageMessage}
${nftStorageStatus}
${tzktApiStatusMessage}
${tzProfilesMessage}
${mempoolMessage}
${restrictedListMessage}
${rpcNodesMessage}
Latest mint is OBJKT ${latestObjtId}.
Number of OBJKT mints in the last 24 hours: ${mintHistoryCount}
Number of Teia swaps in the last 24 hours: ${swapHistoryCount}`
}

let firstTime = true
const startChecking = async () => {

  const checkAll = async () => {
    console.log('Checking status...')
    await checkTzktStatus()
    await getSwapHistory()
    await getMintHistory()
    await checkIpfsGateway()
    await checkIndexerStatus()
    await checkTeiaTzktIndexerStatus()
    await checkTeztokIndexerStatus()
    await checkObjktIndexerStatus()
    await getLastestId()
    await checkGui()
    await checkNftStorage()
    await checkTzProfiles()
    await checkMempool()
    await checkRestrictedList()
    await checkRpcNodes()
    //await checkDaoTokenDistributionVotes()
    await checkTeiaIpfsGateway()

    if (firstTime) {
      firstTime = false
      console.log(getStatus())
    }
  }
  checkAll()

  // Check every minute
  setInterval(async () => {
    checkAll()
  }, 1 * 60 * 1000)
}
startChecking()

const test = async () => {
  await checkTzktStatus()
  await checkRpcNodes()
  //console.log(getStatus())
  console.log(rpcNodesMessage)
}
//test()

exports.startChecking = startChecking
exports.getStatus = getStatus