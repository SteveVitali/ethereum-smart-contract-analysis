#!/bin/bash

cat nohup.out

echo "Total Analysis Progress:"
ls ethereumetl/export/contracts_analysis

echo "Analyzing range: ${START_BLOCK} - ${END_BLOCK}"

# Default batch size = 100000
batch_size=${BATCH_SIZE:=100000}

for (( s=$START_BLOCK; s <= $END_BLOCK; s+=$batch_size )); do
	e=$(($s + $batch_size - 1))

	START=start_block=0${s}
	END=end_block=0${e}
	CSV=contracts_0${s}_0${e}.csv

        contract_path=ethereumetl/export/contracts/${START}/${END}/${CSV}

        contract_count=$(wc -l $contract_path | awk '{print $1;}')

	echo "# Contracts in ${s}-${e}: ${contract_count}"
done
