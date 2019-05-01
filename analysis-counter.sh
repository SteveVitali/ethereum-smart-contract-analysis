#!/bin/bash

# Print for each start_block the number of contracts in the
# block range start_block - start_block + BATCH_SIZE

# Default batch size = 100000
batch_size=${BATCH_SIZE:=100000}
START_BLOCK=0
END_BLOCK=7532178

for (( s=$START_BLOCK; s <= $END_BLOCK; s+=$batch_size )); do
	e=$(($s + $batch_size - 1))
        if [ "$s" -lt 1000000 ]; then
		pre="00"
	else
		pre="0"
	fi
	START=start_block=${pre}${s}
	END=end_block=${pre}${e}
	CSV=contracts_analysis_${pre}${s}_${pre}${e}.csv

        contract_path=ethereumetl/export/contracts_analysis/${START}/${END}/${CSV}
	# echo $contract_path
        contract_count=$(wc -l $contract_path | awk '{print $1;}')

	echo "${s}: ${contract_count},"
done

