export default {
  blocks:
    `number,hash,parent_hash,nonce,sha3_uncles,logs_bloom,transactions_root,
    state_root,receipts_root,miner,difficulty,total_difficulty,size,extra_data,
    gas_limit,gas_used,timestamp,transaction_count`,

  // contract_addresses: ``,

  contracts:
    `address,bytecode,function_sighashes,is_erc20,is_erc721`,

  logs:
    `log_index,transaction_hash,transaction_index,block_hash,
    block_number,address,data,topics`,

  receipts:
    `transaction_hash,transaction_index,block_hash,block_number,
    cumulative_gas_used,gas_used,contract_address,root,status`,

  // token_addresses: ``,

  token_transfers:
    `token_address,from_address,to_address,value,transaction_hash,
    log_index,block_number`,

  // transaction_hashes: ``,

  transactions:
    `hash,nonce,block_hash,block_number,transaction_index,
    from_address,to_address,value,gas,gas_price,input`
}
